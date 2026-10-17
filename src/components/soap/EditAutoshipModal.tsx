import { useEffect, useMemo, useState } from 'react';
import {
  emailStoreSubscriptionUpdate,
  listOnlineStoreItems,
  listOnlineStoreListings,
  listStoreSubscriptions,
  patchStoreSubscription,
  type MailOrderLine,
  type StoreItemRow,
  type StoreStaffSubscription,
} from '../../api/onlineStore';
import { fetchAllEmployees, type Employee } from '../../api/appointmentSettings';
import { formatEmployeeDisplayName } from '../../utils/employeeDisplayName';
import {
  AUTOSHIP_FREQS,
  autoshipCadencePhrase,
  formatAutoshipFrequency,
  nextAutoshipRenewalDate,
} from '../../pages/store/storeCartState';
import '../../pages/Settings.css';
import './EditAutoshipModal.css';

type Props = {
  open: boolean;
  practiceId: number;
  line: MailOrderLine;
  patientName?: string | null;
  customerName?: string | null;
  customerEmail?: string | null;
  /** Preferred doctor for re-approval (falls back to line doctor). */
  preferredAssigneeId?: number | null;
  staff?: Employee[];
  onClose: () => void;
  onSaved: (message?: string | null) => void;
};

type SearchHit = {
  inventoryItemId: number;
  name: string;
  onlineStorePrice: number | null;
  code: string | null;
};

type ProductDisposition = 'request_approval' | 'staff_override';

function money(value?: number | null): string {
  return `$${Number(value || 0).toFixed(2)}`;
}

function itemPrice(item: SearchHit | undefined): number {
  return Number(item?.onlineStorePrice ?? 0) || 0;
}

function firstName(name?: string | null): string {
  return (name || '').trim().split(/\s+/)[0] || 'there';
}

const OVERRIDE_PRESETS = [
  'Based on chart',
  'Refills remaining on prior Rx',
  'Same medication / strength or pack change only',
];

export default function EditAutoshipModal({
  open,
  practiceId,
  line,
  patientName,
  customerName,
  customerEmail,
  preferredAssigneeId,
  staff: staffProp,
  onClose,
  onSaved,
}: Props) {
  const [sub, setSub] = useState<StoreStaffSubscription | null>(null);
  const [catalog, setCatalog] = useState<SearchHit[]>([]);
  const [staff, setStaff] = useState<Employee[]>(staffProp || []);
  const [itemSearch, setItemSearch] = useState('');
  const [inventoryItemId, setInventoryItemId] = useState<number>(0);
  const [productName, setProductName] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [frequency, setFrequency] = useState('monthly');
  const [renewalDate, setRenewalDate] = useState('');
  const [settleMode, setSettleMode] = useState<'auto' | 'charge' | 'refund' | 'credit'>('auto');
  const [disposition, setDisposition] = useState<ProductDisposition>('request_approval');
  const [assigneeId, setAssigneeId] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (staffProp?.length) setStaff(staffProp);
  }, [staffProp]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setNote(null);
    setEmailOpen(false);
    setDisposition('request_approval');
    setOverrideReason('');
    void Promise.all([
      listStoreSubscriptions(practiceId),
      listOnlineStoreItems(practiceId).catch(() => [] as StoreItemRow[]),
      listOnlineStoreListings(practiceId).catch(() => []),
      staffProp?.length
        ? Promise.resolve(staffProp)
        : fetchAllEmployees().then((rows) =>
            rows.filter((row) => row.isActive !== false && !row.isDeleted),
          ),
    ])
      .then(([subs, items, listings, employees]) => {
        if (cancelled) return;
        setStaff(employees);
        const byId = new Map<number, SearchHit>();
        for (const item of items) {
          byId.set(item.inventoryItemId, {
            inventoryItemId: item.inventoryItemId,
            name: item.name,
            onlineStorePrice: item.onlineStorePrice,
            code: item.code,
          });
        }
        for (const listing of listings) {
          for (const variant of listing.variants || []) {
            if (variant.inventoryItemId == null) continue;
            if (byId.has(variant.inventoryItemId)) continue;
            byId.set(variant.inventoryItemId, {
              inventoryItemId: variant.inventoryItemId,
              name: variant.name || listing.name,
              onlineStorePrice: variant.onlineStorePrice,
              code: variant.code,
            });
          }
        }
        setCatalog([...byId.values()].sort((a, b) => a.name.localeCompare(b.name)));
        const match =
          (line.subscriptionId
            ? subs.find((row) => row.id === line.subscriptionId)
            : null) ||
          subs.find(
            (row) =>
              row.active &&
              Number(row.inventoryItemId) === Number(line.inventoryItemId) &&
              (line.patientId == null || Number(row.patientId) === Number(line.patientId)),
          ) ||
          null;
        if (!match) {
          setSub(null);
          setError('No active auto-ship subscription found for this line.');
          return;
        }
        setSub(match);
        setInventoryItemId(Number(match.inventoryItemId));
        setProductName(match.itemName || line.name || `Item #${match.inventoryItemId}`);
        setQuantity(String(Math.max(1, Number(match.quantity) || 1)));
        setFrequency(match.frequency || line.autoshipFrequency || 'monthly');
        setRenewalDate((match.renewalDate || line.renewalDate || '').slice(0, 10));
        setItemSearch('');
        setSettleMode('auto');
        const preferred =
          preferredAssigneeId ||
          employees.find(
            (row) =>
              formatEmployeeDisplayName(row) === (line.primaryProviderName || ''),
          )?.id;
        if (preferred) setAssigneeId(String(preferred));
        else if (employees[0]?.id) setAssigneeId(String(employees[0].id));
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Could not load auto-ship.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, practiceId, line, preferredAssigneeId, staffProp]);

  const selectedItem = useMemo(
    () => catalog.find((item) => item.inventoryItemId === inventoryItemId),
    [catalog, inventoryItemId],
  );

  const productChanged = Boolean(
    sub && inventoryItemId > 0 && inventoryItemId !== Number(sub.inventoryItemId),
  );

  const searchHits = useMemo(() => {
    const needle = itemSearch.trim().toLowerCase();
    if (needle.length < 2) return [];
    return catalog
      .filter(
        (item) =>
          item.name.toLowerCase().includes(needle) ||
          String(item.inventoryItemId).includes(needle) ||
          (item.code || '').toLowerCase().includes(needle),
      )
      .slice(0, 25);
  }, [catalog, itemSearch]);

  const preview = useMemo(() => {
    if (!sub) return null;
    const qty = Math.max(1, Number(quantity) || 1);
    const oldTotal = Number(sub.unitPrice || 0) * Number(sub.quantity || 1);
    const nextUnit =
      inventoryItemId !== Number(sub.inventoryItemId)
        ? itemPrice(selectedItem) || Number(sub.unitPrice || 0)
        : Number(sub.unitPrice || 0);
    const newTotal = nextUnit * qty;
    const delta = Math.round((newTotal - oldTotal) * 100) / 100;
    return { qty, nextUnit, oldTotal, newTotal, delta };
  }, [sub, quantity, inventoryItemId, selectedItem]);

  const displayName = selectedItem?.name || productName;

  function buildEmailDraft() {
    if (!sub || !preview) return;
    const pet = patientName?.trim() || 'your pet';
    const cadence = autoshipCadencePhrase(frequency) || formatAutoshipFrequency(frequency);
    const nextShip = renewalDate
      ? new Date(`${renewalDate}T12:00:00`).toLocaleDateString('en-US', {
          month: 'long',
          day: 'numeric',
          year: 'numeric',
        })
      : 'the next renewal date';
    const changedItem = inventoryItemId !== Number(sub.inventoryItemId);
    const lines = [
      `Hi ${firstName(customerName)},`,
      '',
      `We updated ${pet}'s auto-ship.`,
      '',
      `Item: ${displayName}`,
      `Quantity: ${preview.qty}`,
      `Schedule: ${cadence}`,
      `Next shipment / charge: ${nextShip}`,
    ];
    if (changedItem) {
      lines.push('', `Previous item: ${sub.itemName || line.name}`);
    }
    if (Math.abs(preview.delta) >= 0.01) {
      if (preview.delta > 0) {
        lines.push(
          '',
          `Because the new cycle total is higher, we charged ${money(preview.delta)} to the card on file for this period (new cycle total ${money(preview.newTotal)}).`,
        );
      } else {
        lines.push(
          '',
          `Because the new cycle total is lower, we credited or refunded ${money(Math.abs(preview.delta))} for this period (new cycle total ${money(preview.newTotal)}).`,
        );
      }
    }
    lines.push(
      '',
      'You can change or cancel this auto-ship anytime from your store account or by contacting us.',
      '',
      'Thank you,',
      'Vet At Your Door',
    );
    setEmailSubject(`Update on ${pet}'s auto-ship`);
    setEmailBody(lines.join('\n'));
    setEmailOpen(true);
  }

  if (!open) return null;

  async function save(opts?: { sendEmail?: boolean }) {
    if (!sub || !preview) return;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      if (productChanged) {
        if (disposition === 'request_approval' && !assigneeId) {
          throw new Error('Choose who should re-approve the new product.');
        }
        if (disposition === 'staff_override' && !overrideReason.trim()) {
          throw new Error(
            'Enter a reason for the override (chart, refills remaining, etc.).',
          );
        }
      }

      const body: Parameters<typeof patchStoreSubscription>[2] = {
        mailOrderLineId: line.id,
      };
      if (productChanged) {
        body.inventoryItemId = inventoryItemId;
        body.productChangeDisposition = disposition;
        if (disposition === 'request_approval') {
          body.assignedToEmployeeId = Number(assigneeId);
        } else {
          body.overrideReason = overrideReason.trim();
        }
      }
      const qty = preview.qty;
      if (qty !== Number(sub.quantity)) body.quantity = qty;
      if (frequency !== sub.frequency) body.frequency = frequency;
      if (renewalDate && renewalDate !== (sub.renewalDate || '').slice(0, 10)) {
        body.renewalDate = renewalDate;
      }
      if (Math.abs(preview.delta) >= 0.01) {
        if (preview.delta > 0) {
          body.settleMode =
            settleMode === 'refund' || settleMode === 'credit' ? 'charge' : settleMode;
        } else {
          body.settleMode =
            settleMode === 'charge' ? 'credit' : settleMode === 'auto' ? 'credit' : settleMode;
        }
      }
      const unchanged =
        body.inventoryItemId == null &&
        body.quantity == null &&
        body.frequency == null &&
        body.renewalDate == null;

      if (unchanged && !opts?.sendEmail) {
        setNote('No changes to save.');
        return;
      }

      const messages: string[] = [];
      if (!unchanged) {
        const next = await patchStoreSubscription(practiceId, sub.id, body);
        if (productChanged) {
          messages.push(
            disposition === 'request_approval'
              ? next.settlement?.message ||
                'Auto-ship updated and re-approval task sent.'
              : next.settlement?.message ||
                'Auto-ship updated with staff override.',
          );
        } else {
          messages.push(next.settlement?.message || 'Auto-ship updated.');
        }
        setSub(next);
        setProductName(next.itemName || displayName);
      }

      if (opts?.sendEmail) {
        if (!emailSubject.trim() || !emailBody.trim()) {
          throw new Error('Generate and review the email before sending.');
        }
        try {
          const emailed = await emailStoreSubscriptionUpdate(practiceId, sub.id, {
            subject: emailSubject.trim(),
            message: emailBody.trim(),
          });
          messages.push(`Emailed ${emailed.emailed}.`);
        } catch (emailErr) {
          if (!unchanged) {
            const detail =
              emailErr instanceof Error ? emailErr.message : 'Could not send email.';
            messages.push(`Email failed: ${detail}`);
            onClose();
            onSaved(messages.join(' '));
            return;
          }
          throw emailErr;
        }
      }

      onClose();
      onSaved(messages.join(' ') || 'Auto-ship updated.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update auto-ship.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="settings-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-autoship-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="settings-modal settings-modal-wide edit-autoship-modal">
        <div className="settings-modal-header">
          <h3 id="edit-autoship-title">Edit auto-ship</h3>
          <button
            type="button"
            className="settings-modal-close"
            disabled={busy}
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="settings-modal-body edit-autoship-modal__body">
          <p className="settings-muted edit-autoship-modal__intro">
            {patientName ? `For ${patientName}. ` : null}
            You can change the product even after approval. Switching products requires
            doctor re-approval or a staff override with a reason. Price differences can
            charge the card on file, refund via Stripe, or add an account credit.
          </p>
          {loading ? <p className="settings-muted">Loading…</p> : null}
          {error ? <p className="settings-error-message">{error}</p> : null}
          {note ? <p className="settings-muted">{note}</p> : null}
          {!loading && sub ? (
            <div className="edit-autoship-modal__form">
              <label className="settings-label">
                Item search
                <input
                  className="settings-input"
                  value={itemSearch}
                  onChange={(e) => setItemSearch(e.target.value)}
                  placeholder="Type at least 2 letters (e.g. Dasuquin)"
                  disabled={busy}
                  autoComplete="off"
                />
              </label>
              {itemSearch.trim().length >= 2 ? (
                <div className="edit-autoship-modal__hits" role="listbox" aria-label="Matching items">
                  {searchHits.length ? (
                    searchHits.map((item) => (
                      <button
                        key={item.inventoryItemId}
                        type="button"
                        role="option"
                        aria-selected={item.inventoryItemId === inventoryItemId}
                        className={`edit-autoship-modal__hit${
                          item.inventoryItemId === inventoryItemId ? ' is-selected' : ''
                        }`}
                        disabled={busy}
                        onClick={() => {
                          setInventoryItemId(item.inventoryItemId);
                          setProductName(item.name);
                          setItemSearch('');
                        }}
                      >
                        <span>{item.name}</span>
                        <span className="settings-muted">
                          {item.onlineStorePrice != null ? money(item.onlineStorePrice) : '—'}
                        </span>
                      </button>
                    ))
                  ) : (
                    <p className="settings-muted" style={{ margin: 0 }}>
                      No store items match “{itemSearch.trim()}”.
                    </p>
                  )}
                </div>
              ) : (
                <p className="settings-muted edit-autoship-modal__hint">
                  Search to switch products (weight band, strength, pack size) — works after
                  prior approval too.
                </p>
              )}
              <div className="edit-autoship-modal__selected">
                <div className="settings-label">Selected product</div>
                <p style={{ margin: 0 }}>
                  {displayName}
                  {selectedItem?.onlineStorePrice != null
                    ? ` · ${money(selectedItem.onlineStorePrice)}`
                    : ''}
                </p>
                {productChanged ? (
                  <p className="settings-muted" style={{ margin: '8px 0 0' }}>
                    Changing from {sub.itemName || line.name}
                  </p>
                ) : null}
              </div>

              {productChanged ? (
                <div className="edit-autoship-modal__disposition">
                  <div className="settings-label">After product change</div>
                  <label className="edit-autoship-modal__radio">
                    <input
                      type="radio"
                      name="product-disposition"
                      checked={disposition === 'request_approval'}
                      disabled={busy}
                      onChange={() => setDisposition('request_approval')}
                    />
                    <span>Request doctor re-approval</span>
                  </label>
                  <label className="edit-autoship-modal__radio">
                    <input
                      type="radio"
                      name="product-disposition"
                      checked={disposition === 'staff_override'}
                      disabled={busy}
                      onChange={() => setDisposition('staff_override')}
                    />
                    <span>Staff override (chart / refills / reason)</span>
                  </label>
                  {disposition === 'request_approval' ? (
                    <label className="settings-label">
                      Send re-approval to
                      <select
                        className="settings-input"
                        value={assigneeId}
                        disabled={busy}
                        onChange={(e) => setAssigneeId(e.target.value)}
                      >
                        <option value="">Choose staff</option>
                        {staff.map((emp) => (
                          <option key={emp.id} value={emp.id}>
                            {formatEmployeeDisplayName(emp) || emp.email}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <div className="edit-autoship-modal__override">
                      <label className="settings-label">
                        Override reason
                        <textarea
                          className="settings-input"
                          rows={3}
                          value={overrideReason}
                          disabled={busy}
                          onChange={(e) => setOverrideReason(e.target.value)}
                          placeholder="e.g. Chart shows ongoing Felimazole at this dose; pack size change only"
                        />
                      </label>
                      <div className="edit-autoship-modal__presets">
                        {OVERRIDE_PRESETS.map((preset) => (
                          <button
                            key={preset}
                            type="button"
                            className="btn secondary"
                            disabled={busy}
                            onClick={() =>
                              setOverrideReason((prev) =>
                                prev.trim() ? `${prev.trim()}; ${preset}` : preset,
                              )
                            }
                          >
                            {preset}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : null}

              <div className="edit-autoship-modal__row">
                <label className="settings-label">
                  Qty
                  <input
                    className="settings-input"
                    type="number"
                    min={1}
                    value={quantity}
                    disabled={busy}
                    onChange={(e) => setQuantity(e.target.value)}
                  />
                </label>
                <label className="settings-label">
                  Frequency
                  <select
                    className="settings-input"
                    value={frequency}
                    disabled={busy}
                    onChange={(e) => {
                      const next = e.target.value;
                      setFrequency(next);
                      setRenewalDate(nextAutoshipRenewalDate(next));
                    }}
                  >
                    {AUTOSHIP_FREQS.map((freq) => (
                      <option key={freq.value} value={freq.value}>
                        {freq.label}
                      </option>
                    ))}
                    {!AUTOSHIP_FREQS.some((freq) => freq.value === frequency) ? (
                      <option value={frequency}>{formatAutoshipFrequency(frequency)}</option>
                    ) : null}
                  </select>
                </label>
                <label className="settings-label">
                  Next ship / charge
                  <input
                    className="settings-input"
                    type="date"
                    value={renewalDate}
                    disabled={busy}
                    onChange={(e) => setRenewalDate(e.target.value)}
                  />
                </label>
              </div>
              {preview && Math.abs(preview.delta) >= 0.01 ? (
                <div className="settings-message edit-autoship-modal__settle">
                  <p style={{ margin: '0 0 8px' }}>
                    Cycle total {money(preview.oldTotal)} → {money(preview.newTotal)} (
                    {preview.delta > 0 ? '+' : ''}
                    {money(preview.delta)}).
                  </p>
                  {preview.delta > 0 ? (
                    <p className="settings-muted" style={{ margin: 0 }}>
                      Will charge the card on file for the difference and post it in Financials.
                    </p>
                  ) : (
                    <label className="settings-label">
                      If we owe them
                      <select
                        className="settings-input"
                        value={settleMode === 'charge' ? 'credit' : settleMode}
                        disabled={busy}
                        onChange={(e) =>
                          setSettleMode(e.target.value as 'auto' | 'refund' | 'credit')
                        }
                      >
                        <option value="credit">Account credit</option>
                        <option value="refund">Stripe refund</option>
                        <option value="auto">Try Stripe refund, else credit</option>
                      </select>
                    </label>
                  )}
                </div>
              ) : null}

              <div className="edit-autoship-modal__email-tools">
                <button
                  type="button"
                  className="btn secondary"
                  disabled={busy}
                  onClick={() => buildEmailDraft()}
                >
                  {emailOpen ? 'Refresh email draft' : 'Generate email'}
                </button>
                {customerEmail ? (
                  <span className="settings-muted">To {customerEmail}</span>
                ) : (
                  <span className="settings-muted">No customer email on this auto-ship.</span>
                )}
              </div>
              {emailOpen ? (
                <div className="edit-autoship-modal__email">
                  <label className="settings-label">
                    Subject
                    <input
                      className="settings-input"
                      value={emailSubject}
                      disabled={busy}
                      onChange={(e) => setEmailSubject(e.target.value)}
                    />
                  </label>
                  <label className="settings-label">
                    Message
                    <textarea
                      className="settings-input edit-autoship-modal__email-body"
                      rows={12}
                      value={emailBody}
                      disabled={busy}
                      onChange={(e) => setEmailBody(e.target.value)}
                    />
                  </label>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="settings-modal-actions edit-autoship-modal__actions">
          <button
            type="button"
            className="btn primary"
            disabled={busy || loading || !sub}
            onClick={() => void save()}
          >
            {busy
              ? 'Saving…'
              : productChanged
                ? disposition === 'request_approval'
                  ? 'Save & request re-approval'
                  : 'Save with override'
                : 'Save auto-ship'}
          </button>
          {emailOpen ? (
            <button
              type="button"
              className="btn primary"
              disabled={busy || loading || !sub || !customerEmail}
              onClick={() => void save({ sendEmail: true })}
            >
              {busy ? 'Working…' : 'Save & send email'}
            </button>
          ) : null}
          <button type="button" className="btn secondary" disabled={busy} onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../auth/useAuth';
import {
  listOnlineStoreItems,
  listStoreSubscriptions,
  patchStoreSubscription,
  type StoreItemRow,
  type StoreStaffSubscription,
} from '../api/onlineStore';
import { AUTOSHIP_FREQS, formatAutoshipFrequency } from './store/storeCartState';
import './Settings.css';
import './MailOrders.css';
import './StoreOps.css';

function practiceIdFromToken(token: string | null): number {
  try {
    if (!token) return Number(import.meta.env.VITE_PRACTICE_ID) || 1;
    const p = JSON.parse(atob(token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/')));
    return Number(p.practiceId ?? p.practice_id) || 1;
  } catch {
    return 1;
  }
}

function money(value?: number | null): string {
  return `$${Number(value || 0).toFixed(2)}`;
}

function subStatus(row: StoreStaffSubscription): 'active' | 'paused' | 'cancelled' {
  if (!row.active) return 'cancelled';
  if (row.paused) return 'paused';
  return 'active';
}

function itemPrice(item: StoreItemRow | undefined): number {
  return Number(item?.onlineStorePrice ?? 0) || 0;
}

function isoAddMonths(months: number): string {
  const date = new Date();
  date.setMonth(date.getMonth() + months);
  return date.toISOString().slice(0, 10);
}

function isoTomorrow(): string {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return date.toISOString().slice(0, 10);
}

function formatPauseUntil(value?: string | null): string {
  if (!value) return '';
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function confirmSettlement(opts: {
  label: string;
  oldTotal: number;
  newTotal: number;
}): 'charge' | 'refund' | 'credit' | 'auto' | null {
  const delta = Math.round((opts.newTotal - opts.oldTotal) * 100) / 100;
  if (delta > 0.009) {
    const ok = window.confirm(
      `${opts.label}\n\nThis is about ${money(delta)} more per cycle. Charge the card on file for the difference now?`,
    );
    return ok ? 'charge' : null;
  }
  if (delta < -0.009) {
    const owed = Math.abs(delta);
    const choice = window.prompt(
      `${opts.label}\n\nThis is about ${money(owed)} less per cycle. Type refund (Stripe) or credit (account credit):`,
      'credit',
    );
    if (choice == null) return null;
    const normalized = choice.trim().toLowerCase();
    if (normalized.startsWith('ref')) return 'refund';
    if (normalized.startsWith('cred')) return 'credit';
    return 'auto';
  }
  const ok = window.confirm(`${opts.label}\n\nPrice is about the same.`);
  return ok ? 'auto' : null;
}

export default function StoreSubscriptionsPage() {
  const { token } = useAuth();
  const practiceId = practiceIdFromToken(token);
  const [rows, setRows] = useState<StoreStaffSubscription[]>([]);
  const [storeItems, setStoreItems] = useState<StoreItemRow[]>([]);
  const [filter, setFilter] = useState<'active' | 'paused' | 'cancelled' | 'all'>('active');
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [pauseRow, setPauseRow] = useState<StoreStaffSubscription | null>(null);
  const [pauseUntil, setPauseUntil] = useState(isoAddMonths(1));
  const [editRow, setEditRow] = useState<StoreStaffSubscription | null>(null);
  const [editItemId, setEditItemId] = useState(0);
  const [editQty, setEditQty] = useState('1');
  const [editFrequency, setEditFrequency] = useState('monthly');
  const [editItemQ, setEditItemQ] = useState('');

  const reload = () =>
    Promise.all([
      listStoreSubscriptions(practiceId),
      listOnlineStoreItems(practiceId).catch(() => [] as StoreItemRow[]),
    ])
      .then(([subs, items]) => {
        setRows(subs);
        setStoreItems(items.filter((row) => row.listed));
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load auto-ships'));

  useEffect(() => {
    void reload();
  }, [practiceId]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((row) => {
      if (filter !== 'all' && subStatus(row) !== filter) return false;
      if (!needle) return true;
      const hay = [row.itemName, row.customerName, row.customerEmail, row.patientName, row.stripeSubscriptionId]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(needle);
    });
  }, [rows, filter, q]);

  const openEdit = (row: StoreStaffSubscription) => {
    setEditRow(row);
    setEditItemId(Number(row.inventoryItemId) || 0);
    setEditQty(String(Number(row.quantity) || 1));
    setEditFrequency(row.frequency || 'monthly');
    setEditItemQ('');
  };

  const editItemChoices = useMemo(() => {
    if (!editRow) return [] as StoreItemRow[];
    const needle = editItemQ.trim().toLowerCase();
    const choices = storeItems
      .filter((item) => {
        if (!needle) {
          return (
            item.inventoryItemId === editItemId ||
            item.name.toLowerCase().includes(
              (editRow.itemName || '').split(/\s+/)[0]?.toLowerCase() || '',
            )
          );
        }
        return (
          item.name.toLowerCase().includes(needle) ||
          String(item.inventoryItemId).includes(needle) ||
          (item.code || '').toLowerCase().includes(needle)
        );
      })
      .slice(0, 40);
    if (
      editItemId &&
      !choices.some((item) => item.inventoryItemId === editItemId)
    ) {
      const fromStore = storeItems.find((item) => item.inventoryItemId === editItemId);
      choices.unshift(
        fromStore || {
          inventoryItemId: editItemId,
          name: editRow.itemName || `Item #${editItemId}`,
          code: null,
          onlineStorePrice: Number(editRow.unitPrice) || null,
          shippable: true,
          hasImage: false,
          approvalTag: 'approved',
          listed: true,
          recommendedFrequency: null,
          storeCategory: null,
          description: null,
        },
      );
    }
    return choices;
  }, [editRow, editItemId, editItemQ, storeItems]);

  const run = async (id: number, body: Parameters<typeof patchStoreSubscription>[2]) => {
    setBusyId(id);
    setError(null);
    setNote(null);
    try {
      const next = await patchStoreSubscription(practiceId, id, body);
      const { settlement, ...sub } = next;
      setRows((current) => current.map((row) => (row.id === id ? sub : row)));
      if (settlement?.message) {
        setNote(settlement.message);
      }
      return sub;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update Stripe subscription');
      return null;
    } finally {
      setBusyId(null);
    }
  };

  const saveEdit = async () => {
    if (!editRow) return;
    const qty = Math.max(1, Math.floor(Number(editQty) || 1));
    const nextItem = storeItems.find((item) => item.inventoryItemId === editItemId);
    const itemChanged = editItemId !== Number(editRow.inventoryItemId);
    const qtyChanged = qty !== Number(editRow.quantity);
    const freqChanged = editFrequency !== editRow.frequency;

    if (!itemChanged && !qtyChanged && !freqChanged) {
      setEditRow(null);
      return;
    }

    const oldTotal = Number(editRow.unitPrice || 0) * Number(editRow.quantity || 1);
    const newUnit = itemChanged ? itemPrice(nextItem) : Number(editRow.unitPrice || 0);
    const newTotal = newUnit * qty;
    const labelParts = [
      itemChanged
        ? `Switch to ${nextItem?.name || `item #${editItemId}`} (${money(newUnit)} each)`
        : null,
      qtyChanged ? `Qty ${editRow.quantity} → ${qty}` : null,
      freqChanged
        ? `Frequency → ${formatAutoshipFrequency(editFrequency)}`
        : null,
    ].filter(Boolean);
    const label = labelParts.join('\n') || 'Update this auto-ship?';

    let settleMode: 'charge' | 'refund' | 'credit' | 'auto' = 'auto';
    if (itemChanged || qtyChanged) {
      const settled = confirmSettlement({ label, oldTotal, newTotal });
      if (settled == null) return;
      settleMode = settled;
    } else {
      const ok = window.confirm(`${label}?`);
      if (!ok) return;
    }

    const body: Parameters<typeof patchStoreSubscription>[2] = { settleMode };
    if (itemChanged) body.inventoryItemId = editItemId;
    if (qtyChanged) body.quantity = qty;
    if (freqChanged) body.frequency = editFrequency;

    const updated = await run(editRow.id, body);
    if (updated) setEditRow(null);
  };

  return (
    <div className="settings-card" style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: '0 0 4px' }}>Auto-ships</h2>
          <p className="settings-muted" style={{ margin: 0 }}>
            Review active shipments, then use Edit to change item, quantity, or frequency.
          </p>
        </div>
        <button type="button" className="btn secondary" onClick={() => void reload()}>
          Refresh
        </button>
      </div>

      <div className="mail-queue__filters">
        {([
          ['active', 'Active'],
          ['paused', 'Paused'],
          ['cancelled', 'Cancelled'],
          ['all', 'All'],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={filter === key ? 'btn primary' : 'btn secondary'}
            onClick={() => setFilter(key)}
          >
            {label}
          </button>
        ))}
        <input
          className="settings-input"
          style={{ maxWidth: 320 }}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Item, client, pet"
        />
      </div>

      {error && (
        <div className="settings-message settings-error-message">
          <span>{error}</span>
          <button type="button" className="btn secondary" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}
      {note && (
        <div className="settings-message">
          <span>{note}</span>
          <button type="button" className="btn secondary" onClick={() => setNote(null)}>
            Dismiss
          </button>
        </div>
      )}

      <div className="mail-queue__list">
        <div className="autoship-list__head" aria-hidden="true">
          <span>Order</span>
          <span>Client</span>
          <span>Patient</span>
          <span>Item</span>
          <span>Frequency</span>
          <span />
        </div>
        {visible.map((row) => {
          const status = subStatus(row);
          const lineTotal = Number(row.unitPrice || 0) * Number(row.quantity || 0);
          return (
            <article key={row.id} className="mail-queue__card autoship-list__card">
              <div className="autoship-list__row">
                <div>
                  <div className="mail-queue__id">
                    {row.mailOrderId ? `#${row.mailOrderId}` : `Sub #${row.id}`}
                  </div>
                  <div className="mail-queue__meta">
                    {row.fulfillmentKind === 'pickup' ? 'Office pickup' : 'Ship'}
                    {row.mailOrderId ? ` · auto-ship #${row.id}` : ''}
                  </div>
                </div>
                <div>
                  <div className="autoship-list__primary">
                    {row.clientId ? (
                      <Link
                        className="mail-queue__pet-link"
                        to={`/schedule/clients?clientId=${encodeURIComponent(String(row.clientId))}`}
                      >
                        {row.customerName || row.customerEmail || 'Client'}
                      </Link>
                    ) : (
                      row.customerName || row.customerEmail || 'Client'
                    )}
                  </div>
                  {row.customerEmail ? (
                    <div className="mail-queue__meta">{row.customerEmail}</div>
                  ) : null}
                </div>
                <div className="autoship-list__primary">
                  {row.patientId ? (
                    <Link
                      className="mail-queue__pet-link"
                      to={`/schedule/patients?patientId=${encodeURIComponent(String(row.patientId))}`}
                    >
                      {row.patientName || `Patient #${row.patientId}`}
                    </Link>
                  ) : (
                    <span className="mail-queue__meta">No pet on file</span>
                  )}
                </div>
                <div>
                  <div className="autoship-list__item">
                    {row.itemName || `Item #${row.inventoryItemId}`}
                  </div>
                  <div className="mail-queue__meta">
                    {money(row.unitPrice)} each · qty {Number(row.quantity)} · {money(lineTotal)}
                  </div>
                </div>
                <div className="autoship-list__primary">
                  {formatAutoshipFrequency(row.frequency)}
                </div>
                <div className="autoship-list__actions">
                  <span
                    className={`mail-queue__badge ${
                      status === 'active' ? 'is-go' : status === 'paused' ? 'is-wait' : 'is-stop'
                    }`}
                  >
                    {status === 'active'
                      ? 'Active'
                      : status === 'paused'
                        ? row.pausedUntil
                          ? `Paused until ${formatPauseUntil(row.pausedUntil)}`
                          : 'Paused'
                        : 'Cancelled'}
                  </span>
                  {row.active ? (
                    <>
                      <button
                        type="button"
                        className="btn primary"
                        disabled={busyId === row.id}
                        onClick={() => openEdit(row)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn secondary"
                        disabled={busyId === row.id}
                        onClick={() => {
                          if (row.paused) {
                            void run(row.id, { paused: false });
                            return;
                          }
                          setPauseUntil(isoAddMonths(1));
                          setPauseRow(row);
                        }}
                      >
                        {row.paused ? 'Resume' : 'Pause'}
                      </button>
                      <button
                        type="button"
                        className="btn secondary"
                        disabled={busyId === row.id}
                        onClick={() => {
                          if (
                            window.confirm(
                              'Cancel this auto-ship permanently? Stripe will stop charging and it will not renew. They can start a new auto-ship later if they change their mind.',
                            )
                          ) {
                            void run(row.id, { cancel: true });
                          }
                        }}
                      >
                        Cancel
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
            </article>
          );
        })}
        {!visible.length && (
          <p className="settings-muted">No auto-ships in this filter yet.</p>
        )}
      </div>

      {editRow ? (
        <div
          className="settings-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-autoship-list-title"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setEditRow(null);
          }}
        >
          <div className="settings-modal edit-autoship-list-modal">
            <div className="settings-modal-header">
              <h3 id="edit-autoship-list-title">Edit auto-ship</h3>
              <button
                type="button"
                className="settings-modal-close"
                onClick={() => setEditRow(null)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="settings-modal-body edit-autoship-list-modal__body">
              <div className="edit-autoship-list-modal__context">
                <div className="edit-autoship-list-modal__context-main">
                  <span>{editRow.customerName || 'Client'}</span>
                  {editRow.patientName ? (
                    <>
                      <span className="edit-autoship-list-modal__dot" aria-hidden="true">·</span>
                      <span>{editRow.patientName}</span>
                    </>
                  ) : null}
                </div>
                {editRow.mailOrderId ? (
                  <div className="edit-autoship-list-modal__context-meta">
                    Order #{editRow.mailOrderId}
                  </div>
                ) : null}
              </div>
              <p className="edit-autoship-list-modal__note settings-muted">
                Price differences charge the card on file, refund via Stripe, or add an account
                credit — and update Financials.
              </p>
              <div className="edit-autoship-list-modal__form">
                <label className="settings-label">
                  Search catalog
                  <input
                    className="settings-input"
                    placeholder="Bravecto, strength…"
                    disabled={busyId === editRow.id}
                    value={editItemQ}
                    onChange={(e) => setEditItemQ(e.target.value)}
                  />
                </label>
                <label className="settings-label">
                  Item
                  <select
                    className="settings-input"
                    disabled={busyId === editRow.id}
                    value={editItemId}
                    onChange={(e) => setEditItemId(Number(e.target.value))}
                  >
                    {editItemChoices.map((item) => (
                      <option key={item.inventoryItemId} value={item.inventoryItemId}>
                        {item.name}
                        {item.onlineStorePrice != null ? ` · ${money(item.onlineStorePrice)}` : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="autoship-edit__row">
                  <label className="settings-label">
                    Qty
                    <input
                      className="settings-input"
                      type="number"
                      min={1}
                      disabled={busyId === editRow.id}
                      value={editQty}
                      onChange={(e) => setEditQty(e.target.value)}
                    />
                  </label>
                  <label className="settings-label">
                    Frequency
                    <select
                      className="settings-input"
                      disabled={busyId === editRow.id}
                      value={editFrequency}
                      onChange={(e) => setEditFrequency(e.target.value)}
                    >
                      {AUTOSHIP_FREQS.map((freq) => (
                        <option key={freq.value} value={freq.value}>
                          {freq.label}
                        </option>
                      ))}
                      {!AUTOSHIP_FREQS.some((freq) => freq.value === editFrequency) ? (
                        <option value={editFrequency}>
                          {formatAutoshipFrequency(editFrequency)}
                        </option>
                      ) : null}
                    </select>
                  </label>
                </div>
              </div>
            </div>
            <div className="edit-autoship-list-modal__footer">
              <button type="button" className="btn secondary" onClick={() => setEditRow(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={busyId === editRow.id}
                onClick={() => void saveEdit()}
              >
                {busyId === editRow.id ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {pauseRow ? (
        <div
          className="settings-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pause-autoship-title"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setPauseRow(null);
          }}
        >
          <div className="settings-modal">
            <div className="settings-modal-header">
              <h3 id="pause-autoship-title">Pause auto-ship</h3>
              <button
                type="button"
                className="settings-modal-close"
                onClick={() => setPauseRow(null)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="settings-modal-body">
              <p className="settings-muted" style={{ marginTop: 0 }}>
                Stripe will not charge while paused. On the resume date Stripe starts collecting
                again; when the next renewal payment succeeds, the fill lands back in the mail
                queue (same as a normal auto-ship renewal). You can also click Resume sooner.
              </p>
              <p style={{ margin: '0 0 12px' }}>
                <strong>{pauseRow.itemName || `Item #${pauseRow.inventoryItemId}`}</strong>
                {pauseRow.patientName ? ` · ${pauseRow.patientName}` : ''}
              </p>
              <div className="mail-queue__actions" style={{ marginBottom: 12 }}>
                <button
                  type="button"
                  className="btn secondary"
                  onClick={() => setPauseUntil(isoAddMonths(1))}
                >
                  1 month
                </button>
                <button
                  type="button"
                  className="btn secondary"
                  onClick={() => setPauseUntil(isoAddMonths(2))}
                >
                  2 months
                </button>
                <button
                  type="button"
                  className="btn secondary"
                  onClick={() => setPauseUntil(isoAddMonths(3))}
                >
                  3 months
                </button>
              </div>
              <label className="settings-label">
                Resume on
                <input
                  className="settings-input"
                  type="date"
                  value={pauseUntil}
                  min={isoTomorrow()}
                  onChange={(e) => setPauseUntil(e.target.value)}
                />
              </label>
            </div>
            <div className="settings-modal-actions">
              <button
                type="button"
                className="btn primary"
                disabled={!pauseUntil || busyId === pauseRow.id}
                onClick={() => {
                  const id = pauseRow.id;
                  void run(id, { paused: true, pausedUntil: pauseUntil }).then((ok) => {
                    if (ok) setPauseRow(null);
                  });
                }}
              >
                Pause until {formatPauseUntil(pauseUntil) || '…'}
              </button>
              <button type="button" className="btn secondary" onClick={() => setPauseRow(null)}>
                Back
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

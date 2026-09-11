import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../auth/useAuth';
import {
  listStoreSubscriptions,
  patchStoreSubscription,
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

export default function StoreSubscriptionsPage() {
  const { token } = useAuth();
  const practiceId = practiceIdFromToken(token);
  const [rows, setRows] = useState<StoreStaffSubscription[]>([]);
  const [filter, setFilter] = useState<'active' | 'paused' | 'cancelled' | 'all'>('active');
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const reload = () =>
    listStoreSubscriptions(practiceId)
      .then(setRows)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load subscriptions'));

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

  const run = async (id: number, body: Parameters<typeof patchStoreSubscription>[2]) => {
    setBusyId(id);
    setError(null);
    try {
      const next = await patchStoreSubscription(practiceId, id, body);
      setRows((current) => current.map((row) => (row.id === id ? next : row)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update Stripe subscription');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="settings-card" style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: '0 0 4px' }}>Subscriptions</h2>
          <p className="settings-muted" style={{ margin: 0 }}>
            Store auto-ship. Pause, edit, or cancel here and Stripe updates with it.
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

      <div className="mail-queue__list">
        {visible.map((row) => {
          const status = subStatus(row);
          const lineTotal = Number(row.unitPrice || 0) * Number(row.quantity || 0);
          return (
            <article key={row.id} className="mail-queue__card">
              <div className="mail-queue__synopsis">
                <div>
                  <div className="mail-queue__id">#{row.id}</div>
                  <div className="mail-queue__meta">
                    {row.fulfillmentKind === 'pickup' ? 'Office pickup' : 'Ship'}
                    {row.mailOrderId ? ` · order #${row.mailOrderId}` : ''}
                  </div>
                  {row.stripeSubscriptionId ? (
                    <div className="mail-queue__meta">{row.stripeSubscriptionId}</div>
                  ) : (
                    <div className="mail-queue__meta">No Stripe subscription yet</div>
                  )}
                </div>
                <div>
                  <div>
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
                  <div className="mail-queue__pets">
                    {row.patientId ? (
                      <Link
                        className="mail-queue__pet-link"
                        to={`/schedule/patients?patientId=${encodeURIComponent(String(row.patientId))}`}
                      >
                        {row.patientName || `Patient #${row.patientId}`}
                      </Link>
                    ) : (
                      'No pet on file'
                    )}
                  </div>
                  <div className="mail-queue__meta">{row.customerEmail}</div>
                </div>
                <div>
                  <h4 style={{ margin: '0 0 4px' }}>{row.itemName || `Item #${row.inventoryItemId}`}</h4>
                  <div className="mail-queue__meta">
                    {money(row.unitPrice)} each · qty {Number(row.quantity)} · {money(lineTotal)}
                  </div>
                  <div className="mail-queue__actions" style={{ marginTop: 8 }}>
                    <label className="settings-label">
                      Qty
                      <input
                        className="settings-input"
                        type="number"
                        min={1}
                        disabled={busyId === row.id || !row.active}
                        defaultValue={Number(row.quantity)}
                        key={`${row.id}-${row.quantity}`}
                        onBlur={(e) => {
                          const qty = Math.max(1, Number(e.target.value) || 1);
                          if (qty !== Number(row.quantity)) void run(row.id, { quantity: qty });
                        }}
                      />
                    </label>
                    <label className="settings-label">
                      Frequency
                      <select
                        className="settings-input"
                        disabled={busyId === row.id || !row.active}
                        value={row.frequency}
                        onChange={(e) => void run(row.id, { frequency: e.target.value })}
                      >
                        {AUTOSHIP_FREQS.map((freq) => (
                          <option key={freq.value} value={freq.value}>
                            {freq.label}
                          </option>
                        ))}
                        {!AUTOSHIP_FREQS.some((freq) => freq.value === row.frequency) ? (
                          <option value={row.frequency}>{formatAutoshipFrequency(row.frequency)}</option>
                        ) : null}
                      </select>
                    </label>
                  </div>
                </div>
                <div className="mail-queue__badges">
                  <span
                    className={`mail-queue__badge ${
                      status === 'active' ? 'is-go' : status === 'paused' ? 'is-wait' : 'is-stop'
                    }`}
                  >
                    {status === 'active'
                      ? `Next bill ${row.renewalDate}`
                      : status === 'paused'
                        ? 'Paused'
                        : 'Cancelled'}
                  </span>
                </div>
                <div className="store-ops__row-actions">
                  <div className="store-ops__amount">{money(lineTotal)}</div>
                  {row.mailOrderId ? (
                    <Link
                      className="btn secondary"
                      to={`/schedule/mail-orders?orderId=${encodeURIComponent(String(row.mailOrderId))}`}
                    >
                      Origin order
                    </Link>
                  ) : null}
                  {row.active ? (
                    <>
                      <button
                        type="button"
                        className="btn secondary"
                        disabled={busyId === row.id}
                        onClick={() => void run(row.id, { paused: !row.paused })}
                      >
                        {row.paused ? 'Resume in Stripe' : 'Pause in Stripe'}
                      </button>
                      <button
                        type="button"
                        className="btn secondary"
                        disabled={busyId === row.id}
                        onClick={() => {
                          if (window.confirm('Cancel this subscription in Stripe?')) {
                            void run(row.id, { cancel: true });
                          }
                        }}
                      >
                        Cancel in Stripe
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
            </article>
          );
        })}
        {!visible.length && (
          <p className="settings-muted">No subscriptions in this filter yet.</p>
        )}
      </div>
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../auth/useAuth';
import {
  listAbandonedCarts,
  resendAbandonedCart,
  type AbandonedCart,
} from '../api/onlineStore';
import { formatAutoshipFrequency } from './store/storeCartState';
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

function when(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function cartTotal(cart: AbandonedCart): number {
  if (cart.recoveredTotal != null) return Number(cart.recoveredTotal);
  if (cart.estimatedTotal != null) return Number(cart.estimatedTotal);
  return (cart.lines || []).reduce(
    (sum, line) => sum + Number(line.unitPrice || 0) * Number(line.quantity || 0),
    0,
  );
}

export default function AbandonedCartsPage() {
  const { token } = useAuth();
  const practiceId = practiceIdFromToken(token);
  const [carts, setCarts] = useState<AbandonedCart[]>([]);
  const [stats, setStats] = useState({
    totalCarts: 0,
    recoveredCount: 0,
    recoveredSales: 0,
    emailedCount: 0,
    automaticRecoveryEnabled: true,
  });
  const [filter, setFilter] = useState<'open' | 'emailed' | 'recovered' | 'all'>('open');
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const reload = () =>
    listAbandonedCarts(practiceId)
      .then((data) => {
        setCarts(data.carts || []);
        setStats(data.stats);
      })
      .catch((e) => {
        const message =
          (e as { response?: { data?: { message?: string } } })?.response?.data?.message ||
          (e instanceof Error ? e.message : 'Could not load abandoned carts');
        setError(String(message));
      });

  useEffect(() => {
    void reload();
  }, [practiceId]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return carts.filter((cart) => {
      if (filter !== 'all' && cart.status !== filter) return false;
      if (!needle) return true;
      const hay = [
        cart.email,
        cart.customerName,
        String(cart.recoveredMailOrderId || ''),
        ...(cart.lines || []).flatMap((line) => [
          line.name,
          ...(line.patientNames || []),
        ]),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(needle);
    });
  }, [carts, filter, q]);

  return (
    <div className="settings-card" style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: '0 0 4px' }}>Abandoned carts</h2>
          <p className="settings-muted" style={{ margin: 0 }}>
            Open carts, reminder emails, and recovered store orders.
          </p>
        </div>
        <button type="button" className="btn secondary" onClick={() => void reload()}>
          Refresh
        </button>
      </div>

      <div className="store-ops__stats">
        <div className="store-ops__stat">
          <strong>{stats.totalCarts}</strong>
          <span>Open carts</span>
        </div>
        <div className="store-ops__stat">
          <strong className="store-ops__stat-go">{money(stats.recoveredSales)}</strong>
          <span>Recovered sales ({stats.recoveredCount})</span>
        </div>
        <div className="store-ops__stat">
          <strong>{stats.automaticRecoveryEnabled ? 'Enabled' : 'Off'}</strong>
          <span>Automatic recovery emails · {stats.emailedCount} sent</span>
        </div>
      </div>

      <div className="mail-queue__filters">
        {([
          ['open', 'Open'],
          ['emailed', 'Emailed'],
          ['recovered', 'Recovered'],
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
          style={{ maxWidth: 360 }}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Cart item, customer, email, pet"
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
        {visible.map((cart) => (
          <article key={cart.id} className="mail-queue__card">
            <div className="mail-queue__synopsis">
              <div>
                <div className="mail-queue__id">#{cart.id}</div>
                <div className="mail-queue__when">{when(cart.touchedAt)}</div>
                {cart.clientId ? (
                  <Link
                    className="mail-queue__pet-link"
                    to={`/schedule/clients?clientId=${encodeURIComponent(String(cart.clientId))}`}
                  >
                    {cart.email}
                  </Link>
                ) : (
                  <div className="mail-queue__meta">{cart.email}</div>
                )}
              </div>
              <div>
                <div>{cart.customerName || 'No name yet'}</div>
                <div className="mail-queue__pets">
                  {(cart.lines || [])
                    .flatMap((line) => line.patientNames || [])
                    .filter((name, idx, all) => all.indexOf(name) === idx)
                    .join(' & ') || 'No pet chosen'}
                </div>
                <div className="mail-queue__meta">{cart.fulfillmentLabel || 'Fulfillment not chosen'}</div>
              </div>
              <div className="mail-queue__items">
                {(cart.lines || []).map((line, idx) => (
                  <span key={`${line.name}-${idx}`}>
                    {line.name} × {Number(line.quantity)}
                    {line.autoshipFrequency
                      ? ` · ${formatAutoshipFrequency(line.autoshipFrequency)}`
                      : ''}
                    {line.unitPrice != null ? ` · ${money(line.unitPrice)}` : ''}
                  </span>
                ))}
              </div>
              <div className="mail-queue__badges">
                <span
                  className={`mail-queue__badge ${
                    cart.status === 'recovered'
                      ? 'is-go'
                      : cart.status === 'emailed'
                        ? 'is-wait'
                        : 'is-warn'
                  }`}
                >
                  {cart.status === 'recovered'
                    ? `Recovered: order #${cart.recoveredMailOrderId}`
                    : cart.emailed
                      ? `Reminder sent${cart.reminderCount > 1 ? ` ×${cart.reminderCount}` : ''}`
                      : 'Open'}
                </span>
              </div>
              <div className="store-ops__row-actions">
                <div className={`store-ops__amount${cart.status === 'recovered' ? ' is-recovered' : ''}`}>
                  {money(cartTotal(cart))}
                </div>
                {cart.status === 'recovered' && cart.recoveredMailOrderId ? (
                  <Link
                    className="btn secondary"
                    to={`/schedule/mail-orders?orderId=${encodeURIComponent(String(cart.recoveredMailOrderId))}`}
                  >
                    View order
                  </Link>
                ) : (
                  <button
                    type="button"
                    className="btn secondary"
                    disabled={busyId === cart.id}
                    onClick={() => {
                      setBusyId(cart.id);
                      setError(null);
                      void resendAbandonedCart(practiceId, cart.id)
                        .then((next) => {
                          setCarts((rows) => rows.map((row) => (row.id === next.id ? next : row)));
                          setStats((current) => ({
                            ...current,
                            emailedCount: current.emailedCount + (cart.emailed ? 0 : 1),
                          }));
                        })
                        .catch((e) => setError(e instanceof Error ? e.message : 'Could not resend'))
                        .finally(() => setBusyId(null));
                    }}
                  >
                    Resend email
                  </button>
                )}
              </div>
            </div>
          </article>
        ))}
        {!visible.length && (
          <p className="settings-muted">
            No carts in this filter. They appear when a shopper adds items and enters an email.
          </p>
        )}
      </div>
    </div>
  );
}

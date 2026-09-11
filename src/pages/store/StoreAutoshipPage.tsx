import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../../auth/useAuth';
import { listMyAutoship, patchMyAutoship, type StoreAutoship } from '../../api/onlineStore';
import { AUTOSHIP_FREQS, formatAutoshipFrequency } from './storeCartState';
import './Store.css';

const PRACTICE_ID = Number(import.meta.env.VITE_PRACTICE_ID) || 1;

export default function StoreAutoshipPage() {
  const auth = useAuth() as { token?: string | null };
  const [rows, setRows] = useState<StoreAutoship[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = () => {
    if (!auth.token) return;
    void listMyAutoship(PRACTICE_ID)
      .then(setRows)
      .catch((e) => setErr(e instanceof Error ? e.message : 'Could not load auto-ship items.'));
  };

  useEffect(() => {
    load();
  }, [auth.token]);

  const run = async (id: number, body: Parameters<typeof patchMyAutoship>[2]) => {
    setBusyId(id);
    setErr(null);
    try {
      const next = await patchMyAutoship(PRACTICE_ID, id, body);
      setRows((current) =>
        body.cancel
          ? current.filter((row) => row.id !== id)
          : current.map((row) => (row.id === id ? next : row)),
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not update auto-ship.');
    } finally {
      setBusyId(null);
    }
  };

  if (!auth.token) {
    return (
      <div className="vayd-store__cart">
        <div className="vayd-store__cart-head">
          <h1>Auto-ship</h1>
          <Link className="ghost" to="/store">
            ← Back to store
          </Link>
        </div>
        <p>
          <Link to="/login" state={{ from: { pathname: '/store/autoship' } }}>
            Log in
          </Link>{' '}
          to see and edit your auto-ship items.
        </p>
      </div>
    );
  }

  return (
    <div className="vayd-store__cart">
      <div className="vayd-store__cart-head">
        <h1>Auto-ship items</h1>
        <Link className="ghost" to="/store">
          ← Back to store
        </Link>
      </div>
      <p className="vayd-store__autoship-note">
        These renew on the card you used at checkout. Changing quantity or frequency updates
        the next Stripe bill.
      </p>
      {err ? <p className="vayd-store__err">{err}</p> : null}
      {!rows.length ? <p>You don’t have any auto-ship items yet.</p> : null}
      <ul className="vayd-store__autoship-list">
        {rows.map((row) => (
          <li key={row.id} className="vayd-store__autoship-card">
            <h2>{row.itemName || `Item #${row.inventoryItemId}`}</h2>
            {row.patientName ? (
              <p className="vayd-store__autoship-pet">For {row.patientName}</p>
            ) : null}
            <p>
              ${Number(row.unitPrice).toFixed(2)} each · qty {Number(row.quantity)} ·{' '}
              {(Number(row.unitPrice) * Number(row.quantity)).toFixed(2)} before tax
            </p>
            <p>
              {formatAutoshipFrequency(row.frequency)}
              {row.paused ? ' · Paused' : ` · next bill ${row.renewalDate}`}
              {row.fulfillmentKind === 'pickup' ? ' · Pickup' : ''}
            </p>
            <div className="vayd-store__cart-fields">
              <label>
                Qty
                <input
                  type="number"
                  min={1}
                  disabled={busyId === row.id}
                  defaultValue={Number(row.quantity)}
                  onBlur={(e) => {
                    const qty = Math.max(1, Number(e.target.value) || 1);
                    if (qty !== Number(row.quantity)) void run(row.id, { quantity: qty });
                  }}
                />
              </label>
              <label>
                Frequency
                <select
                  disabled={busyId === row.id}
                  value={row.frequency}
                  onChange={(e) => void run(row.id, { frequency: e.target.value })}
                >
                  {AUTOSHIP_FREQS.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                  {!AUTOSHIP_FREQS.some((f) => f.value === row.frequency) ? (
                    <option value={row.frequency}>{formatAutoshipFrequency(row.frequency)}</option>
                  ) : null}
                </select>
              </label>
            </div>
            <div className="vayd-store__actions" style={{ marginTop: 12 }}>
              <button
                type="button"
                className="ghost"
                disabled={busyId === row.id}
                onClick={() => void run(row.id, { paused: !row.paused })}
              >
                {row.paused ? 'Resume' : 'Pause'}
              </button>
              <button
                type="button"
                className="ghost"
                disabled={busyId === row.id}
                onClick={() => {
                  if (window.confirm('Cancel this auto-ship? You can add it again from the store.')) {
                    void run(row.id, { cancel: true });
                  }
                }}
              >
                Cancel
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

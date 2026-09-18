import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { listPracticeBranches, type PracticeBranch } from '../api/branchInventory';
import {
  listCostReviews,
  resolveCostReview,
  type InventoryCostReview,
} from '../api/inventoryOps';
import { resolvePracticeIdFromToken } from '../utils/practiceIdFromToken';
import './Settings.css';

function money(n: number | null | undefined, digits = 4): string {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return `$${Number(n).toFixed(digits)}`;
}

function deltaLabel(row: InventoryCostReview): string {
  if (row.costDelta == null) return 'New cost (no prior catalog cost)';
  const sign = row.costDelta > 0 ? '+' : '';
  const pct =
    row.costDeltaPct != null ? ` (${sign}${row.costDeltaPct.toFixed(1)}%)` : '';
  return `${sign}${money(row.costDelta)}${pct}`;
}

export default function InventoryCostReviewsPage() {
  const { token } = useAuth() as { token: string | null };
  const practiceId = useMemo(() => resolvePracticeIdFromToken(token), [token]);
  const [branches, setBranches] = useState<PracticeBranch[]>([]);
  const [branchId, setBranchId] = useState<number | ''>('');
  const [status, setStatus] = useState('pending');
  const [rows, setRows] = useState<InventoryCostReview[]>([]);
  const [busy, setBusy] = useState(false);
  const [actingId, setActingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void listPracticeBranches(practiceId)
      .then((list) => {
        setBranches(list.filter((b) => b.isActive !== false));
      })
      .catch(() => setError('Could not load offices'));
  }, [practiceId]);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await listCostReviews(practiceId, {
        branchId: branchId === '' ? undefined : Number(branchId),
        status,
      });
      setRows(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not load cost reviews');
    } finally {
      setBusy(false);
    }
  }, [branchId, practiceId, status]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onResolve(
    row: InventoryCostReview,
    action: 'apply_catalog' | 'apply_branch' | 'dismiss'
  ) {
    setActingId(row.id);
    setError(null);
    setMessage(null);
    try {
      await resolveCostReview(practiceId, row.id, { action });
      setMessage(
        action === 'apply_catalog'
          ? `Updated practice catalog cost for ${row.itemName ?? 'item'}.`
          : action === 'apply_branch'
            ? `Set office-only cost override for ${row.itemName ?? 'item'}.`
            : `Dismissed review for ${row.itemName ?? 'item'}.`
      );
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not resolve review');
    } finally {
      setActingId(null);
    }
  }

  return (
    <div className="settings-card" style={{ maxWidth: 960, margin: '0 auto', padding: 16 }}>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <div>
          <h2 style={{ margin: 0 }}>Cost reviews</h2>
          <p className="settings-muted" style={{ margin: '4px 0 0' }}>
            When a received invoice cost differs from catalog cost, decide whether to update
            practice pricing, office-only overrides, or leave prices unchanged.
          </p>
        </div>
        <button className="btn secondary" type="button" disabled={busy} onClick={() => void load()}>
          Refresh
        </button>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
          gap: 12,
          margin: '18px 0',
        }}
      >
        <label className="settings-label">
          Office
          <select
            className="settings-input"
            value={branchId}
            onChange={(e) => setBranchId(e.target.value ? Number(e.target.value) : '')}
          >
            <option value="">All offices</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </select>
        </label>
        <label className="settings-label">
          Status
          <select
            className="settings-input"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="pending">Pending</option>
            <option value="applied_catalog">Applied to catalog</option>
            <option value="applied_branch">Applied to office</option>
            <option value="dismissed">Dismissed</option>
            <option value="all">All</option>
          </select>
        </label>
      </div>

      {error && <div className="settings-message settings-error-message">{error}</div>}
      {message && <div className="settings-message">{message}</div>}

      {busy && rows.length === 0 ? (
        <p className="settings-muted">Loading cost reviews…</p>
      ) : rows.length === 0 ? (
        <p className="settings-muted">
          {status === 'pending'
            ? 'No pending cost differences. Receiving stock no longer changes catalog prices automatically.'
            : 'No matching cost reviews.'}
        </p>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {rows.map((row) => {
            const pending = row.status === 'pending';
            const acting = actingId === row.id;
            return (
              <article
                key={row.id}
                style={{
                  border: '1px solid var(--border, #e5e7eb)',
                  borderRadius: 10,
                  padding: 12,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                    flexWrap: 'wrap',
                    gap: 8,
                  }}
                >
                  <strong>
                    {row.itemName ?? `Item #${row.inventoryItemId}`}
                    {row.itemCode ? ` · ${row.itemCode}` : ''}
                  </strong>
                  <time className="settings-muted">
                    {row.created ? new Date(row.created).toLocaleString() : ''}
                  </time>
                </div>
                <div className="settings-muted" style={{ marginTop: 4 }}>
                  {row.branchName ?? `Office #${row.branchId}`}
                  {row.invoiceNumber ? ` · Invoice ${row.invoiceNumber}` : ''}
                  {` · Qty ${row.quantity}`}
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                    gap: 8,
                    marginTop: 10,
                  }}
                >
                  <div>
                    <div className="settings-muted">Catalog cost</div>
                    <div>{money(row.previousCost)}</div>
                  </div>
                  <div>
                    <div className="settings-muted">Invoice cost / unit</div>
                    <div>{money(row.receivedCostPerUnit)}</div>
                  </div>
                  <div>
                    <div className="settings-muted">Difference</div>
                    <div>{deltaLabel(row)}</div>
                  </div>
                  <div>
                    <div className="settings-muted">Catalog price → suggested</div>
                    <div>
                      {money(row.previousPrice, 2)} → {money(row.suggestedPrice, 2)}
                    </div>
                  </div>
                </div>
                {pending ? (
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: 8,
                      marginTop: 12,
                    }}
                  >
                    <button
                      className="btn primary"
                      type="button"
                      disabled={acting}
                      onClick={() => void onResolve(row, 'apply_catalog')}
                      title="Update practice-wide catalog cost and suggested sell price"
                    >
                      Update catalog
                    </button>
                    <button
                      className="btn secondary"
                      type="button"
                      disabled={acting}
                      onClick={() => void onResolve(row, 'apply_branch')}
                      title="Override cost/price for this office only"
                    >
                      Office only
                    </button>
                    <button
                      className="btn secondary"
                      type="button"
                      disabled={acting}
                      onClick={() => void onResolve(row, 'dismiss')}
                      title="Keep current catalog and office pricing"
                    >
                      Keep current
                    </button>
                  </div>
                ) : (
                  <div className="settings-muted" style={{ marginTop: 10 }}>
                    Resolved: {row.status.replace(/_/g, ' ')}
                    {row.resolutionNote ? ` · ${row.resolutionNote}` : ''}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

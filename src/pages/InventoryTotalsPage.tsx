import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth/useAuth';
import { listPracticeBranches, type PracticeBranch } from '../api/branchInventory';
import {
  getInventoryCostSummary,
  type InventoryCostSummary,
} from '../api/inventoryTools';
import { resolvePracticeIdFromToken } from '../utils/practiceIdFromToken';
import './Settings.css';

const BRANCH_STORAGE_PREFIX = 'vayd_inventory_branch:';

export default function InventoryTotalsPage() {
  const { token } = useAuth() as { token: string | null };
  const practiceId = useMemo(() => resolvePracticeIdFromToken(token), [token]);
  const [branches, setBranches] = useState<PracticeBranch[]>([]);
  const [branchId, setBranchId] = useState<number | null>(null);
  const [branchesError, setBranchesError] = useState<string | null>(null);
  const [costSummary, setCostSummary] = useState<InventoryCostSummary | null>(null);
  const [costSummaryLoading, setCostSummaryLoading] = useState(false);
  const [costSummaryError, setCostSummaryError] = useState<string | null>(null);

  const persistBranch = useCallback(
    (id: number) => {
      try {
        localStorage.setItem(`${BRANCH_STORAGE_PREFIX}${practiceId}`, String(id));
      } catch {
        /* ignore */
      }
    },
    [practiceId]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setBranchesError(null);
      try {
        const list = await listPracticeBranches(practiceId);
        if (cancelled) return;
        const active = list.filter((b) => b.isActive !== false);
        setBranches(active);
        let initial: number | null = null;
        try {
          const stored = localStorage.getItem(`${BRANCH_STORAGE_PREFIX}${practiceId}`);
          if (stored) {
            const n = Number(stored);
            if (Number.isFinite(n) && active.some((b) => b.id === n)) initial = n;
          }
        } catch {
          /* ignore */
        }
        if (initial == null) {
          const def = active.find((b) => b.isDefault);
          initial = def?.id ?? active[0]?.id ?? null;
        }
        setBranchId(initial);
      } catch (e: unknown) {
        if (!cancelled) {
          setBranchesError(e instanceof Error ? e.message : 'Failed to load branches');
          setBranches([]);
          setBranchId(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [practiceId]);

  useEffect(() => {
    if (branchId == null) {
      setCostSummary(null);
      setCostSummaryError(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setCostSummaryLoading(true);
      setCostSummaryError(null);
      try {
        const s = await getInventoryCostSummary(practiceId, branchId);
        if (!cancelled) setCostSummary(s);
      } catch (e: unknown) {
        if (!cancelled) {
          setCostSummary(null);
          setCostSummaryError(
            e instanceof Error
              ? e.message
              : 'Could not load branch cost summary (backend may not expose this endpoint yet).'
          );
        }
      } finally {
        if (!cancelled) setCostSummaryLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [practiceId, branchId]);

  return (
    <div className="settings-section">
      <div className="settings-form-group" style={{ marginBottom: 20 }}>
        <label className="settings-label" htmlFor="inv-totals-branch">
          Branch
        </label>
        {branchesError && (
          <p className="settings-error-message" style={{ marginTop: 4 }}>
            {branchesError}
          </p>
        )}
        <select
          id="inv-totals-branch"
          className="settings-input"
          style={{ maxWidth: 420 }}
          value={branchId ?? ''}
          disabled={!branches.length}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v)) {
              setBranchId(v);
              persistBranch(v);
            }
          }}
        >
          {!branches.length && <option value="">No branches</option>}
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
              {b.isDefault ? ' (default)' : ''}
            </option>
          ))}
        </select>
        <p className="settings-muted" style={{ marginTop: 8, fontSize: 13 }}>
          Add or edit branches and location buckets under{' '}
          <a href="/schedule/settings?tab=branches-locations">Settings → Branches &amp; Locations</a>.
        </p>
      </div>

      {branchId != null && (
        <div className="settings-card">
          <h3 className="settings-card-title">Inventory cost (this branch)</h3>
          <p className="settings-muted" style={{ marginBottom: 12 }}>
            Total and per-location extended cost (unit cost × quantity on hand) across the whole
            branch catalog.
          </p>
          {costSummaryLoading && <p className="settings-muted">Loading cost summary…</p>}
          {costSummaryError && !costSummaryLoading && (
            <div className="settings-message settings-error-message" style={{ marginBottom: 8 }}>
              {costSummaryError}
            </div>
          )}
          {costSummary && !costSummaryLoading && (
            <>
              <p style={{ margin: '0 0 12px', fontSize: 18 }}>
                <strong>Total extended cost:</strong> $
                {Number(costSummary.totalExtendedCost).toFixed(2)}
              </p>
              {costSummary.byLocation && costSummary.byLocation.length > 0 && (
                <div className="settings-table-container">
                  <table className="settings-table">
                    <thead>
                      <tr>
                        <th>Location</th>
                        <th>Code</th>
                        <th>Extended cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {costSummary.byLocation.map((row, i) => (
                        <tr key={`${row.branchLocationId ?? 'x'}-${row.code}-${i}`}>
                          <td>{row.name}</td>
                          <td>
                            <code>{row.code}</code>
                          </td>
                          <td>${Number(row.extendedCost).toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

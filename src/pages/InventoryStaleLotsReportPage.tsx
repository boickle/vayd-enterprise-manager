import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../auth/useAuth';
import { readImpersonation } from '../auth/impersonationSession';
import { listPracticeBranches, type PracticeBranch } from '../api/branchInventory';
import {
  addWeeklyCountItems,
  listStaleLots,
  type StaleLotFlagType,
  type StaleLotRow,
} from '../api/inventoryCounts';
import { apiErrorMessage } from '../api/http';
import { fetchMyOffices } from '../api/permissions';
import { addedSummary } from '../components/inventory/AddToWeeklyCountModal';
import { usePermissions } from '../permissions/PermissionContext';
import { resolvePracticeIdFromToken } from '../utils/practiceIdFromToken';
import './Settings.css';

const WEEKLY_ADD_PERMISSION = 'inventory.count.add_weekly';

const FLAG_LABELS: Record<StaleLotFlagType, string> = {
  skipped_over: 'Skipped over',
  nearly_empty: 'Nearly empty, stuck',
  no_movement: 'No movement',
};

function shortDate(iso: string | null): string {
  if (!iso) return 'Never';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso.slice(0, 10)
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Stale lots: lots with stock on hand that are being skipped over, nearly empty and stuck, or not
 * moving at all (CAT-10). Thresholds are in Settings → Count alerts. Admins and practice managers
 * can put the item on the office's next weekly count from here.
 */
export default function InventoryStaleLotsReportPage() {
  const { token } = useAuth() as { token: string | null };
  const practiceId = useMemo(() => resolvePracticeIdFromToken(token), [token]);
  const { can } = usePermissions();
  const canAddWeekly = can(WEEKLY_ADD_PERMISSION) && readImpersonation() == null;

  const [branches, setBranches] = useState<PracticeBranch[]>([]);
  const [branchId, setBranchId] = useState<number | ''>('');
  const [flag, setFlag] = useState<StaleLotFlagType | ''>('');
  const [controlledOnly, setControlledOnly] = useState(false);
  const [rows, setRows] = useState<StaleLotRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    void Promise.all([
      listPracticeBranches(practiceId),
      fetchMyOffices(practiceId, 'inventory.par.manage').catch(() => 'all' as const),
      fetchMyOffices(practiceId, 'inventory.count.review_controlled').catch(() => [] as number[]),
    ])
      .then(([list, full, controlled]) => {
        const allowed = (id: number) =>
          full === 'all' || controlled === 'all' || full.includes(id) || controlled.includes(id);
        setBranches(list.filter((b) => b.isActive !== false && allowed(b.id)));
      })
      .catch(() => setBranches([]));
  }, [practiceId]);

  const load = useCallback(() => {
    let cancelled = false;
    setBusy(true);
    setError(null);
    void listStaleLots(practiceId, {
      branchId: branchId === '' ? undefined : Number(branchId),
      flag: flag || undefined,
      controlledOnly,
    })
      .then((data) => {
        if (cancelled) return;
        setRows(data.rows ?? []);
        setSelected(new Set());
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(apiErrorMessage(e));
        setRows([]);
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [practiceId, branchId, flag, controlledOnly]);

  useEffect(() => load(), [load]);

  const toggle = (lotId: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(lotId)) next.delete(lotId);
      else next.add(lotId);
      return next;
    });

  const addRows = async (picked: StaleLotRow[]) => {
    if (!picked.length) return;
    setAdding(true);
    setMessage(null);
    try {
      // One request per office: the weekly count belongs to an office.
      const byOffice = new Map<number, Set<number>>();
      for (const r of picked) {
        const ids = byOffice.get(r.branchId) ?? new Set<number>();
        ids.add(r.inventoryItemId);
        byOffice.set(r.branchId, ids);
      }
      const total = { added: 0, alreadyOnSheet: 0, notCountable: 0 };
      for (const [office, ids] of byOffice) {
        const res = await addWeeklyCountItems(practiceId, office, { inventoryItemIds: [...ids] });
        total.added += res.added;
        total.alreadyOnSheet += res.alreadyOnSheet;
        total.notCountable += res.notCountable;
      }
      setMessage({ ok: true, text: addedSummary(total) });
      setSelected(new Set());
    } catch (e: unknown) {
      setMessage({ ok: false, text: apiErrorMessage(e) });
    } finally {
      setAdding(false);
    }
  };

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.lotId));

  return (
    <div className="settings-section">
      <p className="settings-section-description">
        Lots with stock on hand that are being skipped over, nearly empty and stuck, or not moving.
        Change what counts as stale in Settings → Count alerts.
      </p>
      {error ? (
        <div className="settings-message settings-error-message" style={{ marginBottom: 12 }}>
          {error}
        </div>
      ) : null}
      {message ? (
        <div
          className={`settings-message ${message.ok ? 'settings-success-message' : 'settings-error-message'}`}
          style={{ marginBottom: 12 }}
        >
          {message.text}
        </div>
      ) : null}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16, alignItems: 'end' }}>
        <label className="settings-label">
          Office
          <select
            className="settings-input"
            style={{ minWidth: 220 }}
            value={branchId}
            onChange={(e) => setBranchId(e.target.value ? Number(e.target.value) : '')}
          >
            <option value="">All offices</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <label className="settings-label">
          Flag
          <select
            className="settings-input"
            value={flag}
            onChange={(e) => setFlag((e.target.value as StaleLotFlagType) || '')}
          >
            <option value="">All flags</option>
            {(Object.keys(FLAG_LABELS) as StaleLotFlagType[]).map((f) => (
              <option key={f} value={f}>
                {FLAG_LABELS[f]}
              </option>
            ))}
          </select>
        </label>
        <label className="settings-checkbox-item">
          <input
            type="checkbox"
            checked={controlledOnly}
            onChange={(e) => setControlledOnly(e.target.checked)}
          />
          <span>Controlled only</span>
        </label>
        {canAddWeekly ? (
          <button
            type="button"
            className="btn primary"
            disabled={adding || selected.size === 0}
            onClick={() => void addRows(rows.filter((r) => selected.has(r.lotId)))}
          >
            {adding ? 'Adding…' : `Add selected to weekly count (${selected.size})`}
          </button>
        ) : null}
      </div>
      <p className="settings-muted" style={{ marginTop: 0 }}>
        {busy ? 'Loading…' : `${rows.length} flagged lot${rows.length === 1 ? '' : 's'}`}
      </p>
      {!busy && rows.length === 0 ? (
        <p className="settings-muted">No stale lots.</p>
      ) : rows.length > 0 ? (
        <div className="settings-table-container">
          <table className="settings-table">
            <thead>
              <tr>
                {canAddWeekly ? (
                  <th>
                    <input
                      type="checkbox"
                      aria-label="Select all"
                      checked={allSelected}
                      onChange={() =>
                        setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.lotId)))
                      }
                    />
                  </th>
                ) : null}
                <th>Item</th>
                <th>Lot</th>
                <th>Expires</th>
                <th>Where</th>
                <th>On hand</th>
                <th>Last drawn</th>
                <th>Why</th>
                {canAddWeekly ? <th /> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.lotId}>
                  {canAddWeekly ? (
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Select ${r.itemName ?? 'item'} lot ${r.lotNumber}`}
                        checked={selected.has(r.lotId)}
                        onChange={() => toggle(r.lotId)}
                      />
                    </td>
                  ) : null}
                  <td>
                    <Link
                      to={`/schedule/inventory/items?itemId=${r.inventoryItemId}${
                        r.itemName ? `&name=${encodeURIComponent(r.itemName)}` : ''
                      }`}
                      style={{ fontWeight: 600, color: 'inherit', textDecoration: 'underline' }}
                    >
                      {r.itemName ?? `Item #${r.inventoryItemId}`}
                    </Link>
                    {r.isControlled ? (
                      <div className="settings-muted" style={{ fontSize: 12 }}>
                        Controlled
                      </div>
                    ) : null}
                  </td>
                  <td>{r.lotNumber || '—'}</td>
                  <td>{r.expirationDate ?? '—'}</td>
                  <td>{[r.branchName, r.locationName].filter(Boolean).join(' · ') || '—'}</td>
                  <td>{r.quantityOnHand}</td>
                  <td>{shortDate(r.lastDrawnAt)}</td>
                  <td>
                    {r.flags.map((f) => (
                      <div key={f.type}>
                        <strong>{FLAG_LABELS[f.type]}</strong>
                        <span className="settings-muted"> · {f.reason}</span>
                      </div>
                    ))}
                  </td>
                  {canAddWeekly ? (
                    <td>
                      <button
                        type="button"
                        className="btn secondary"
                        disabled={adding}
                        onClick={() => void addRows([r])}
                      >
                        Add to weekly count
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import {
  listInventoryBranchLocations,
  listInventoryMovements,
  listPracticeBranches,
  type InventoryBranchLocation,
  type InventoryStockMovement,
  type PracticeBranch,
} from '../api/branchInventory';
import { resolvePracticeIdFromToken } from '../utils/practiceIdFromToken';
import './Settings.css';

const ACTION_LABELS: Record<string, string> = {
  receive: 'Received',
  transfer: 'Moved',
  sold: 'Sold',
  visit_use: 'Used on visit',
  adjustment_increase: 'Adjusted up',
  adjustment_decrease: 'Adjusted down',
  expired: 'Wasted / expired',
};

function actorLabel(row: InventoryStockMovement): string {
  const employee = row.movedByEmployee;
  const name = [employee?.firstName, employee?.lastName].filter(Boolean).join(' ');
  if (name) return name;
  if (row.movedByEmployeeId != null) return `Employee #${row.movedByEmployeeId}`;
  if (row.movedByUser?.email) return row.movedByUser.email;
  if (row.movedByUserId != null) return `User #${row.movedByUserId}`;
  return 'System';
}

function locationText(row: InventoryStockMovement): string {
  const from = row.fromBranchLocation?.name;
  const to = row.toBranchLocation?.name;
  if (from && to) return `${from} → ${to}`;
  if (to) return `into ${to}`;
  if (from) return `from ${from}`;
  return '';
}

export default function InventoryActivityPage() {
  const { token } = useAuth() as { token: string | null };
  const practiceId = useMemo(() => resolvePracticeIdFromToken(token), [token]);
  const [branches, setBranches] = useState<PracticeBranch[]>([]);
  const [locations, setLocations] = useState<InventoryBranchLocation[]>([]);
  const [branchId, setBranchId] = useState<number | ''>('');
  const [locationId, setLocationId] = useState<number | ''>('');
  const [rows, setRows] = useState<InventoryStockMovement[]>([]);
  const [total, setTotal] = useState(0);
  const [action, setAction] = useState('');
  const [exceptionsOnly, setExceptionsOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void listPracticeBranches(practiceId)
      .then((list) => {
        const active = list.filter((b) => b.isActive !== false);
        setBranches(active);
        const initial = active.find((b) => b.isDefault) ?? active[0];
        if (initial) setBranchId(initial.id);
      })
      .catch(() => setError('Could not load offices'));
  }, [practiceId]);

  useEffect(() => {
    if (branchId === '') {
      setLocations([]);
      setLocationId('');
      return;
    }
    void listInventoryBranchLocations(practiceId, Number(branchId))
      .then((locs) => {
        setLocations(locs.filter((l) => l.isActive !== false));
      })
      .catch(() => setLocations([]));
    setLocationId('');
  }, [practiceId, branchId]);

  const load = useCallback(async () => {
    if (branchId === '') return;
    setBusy(true);
    setError(null);
    try {
      const result = await listInventoryMovements(practiceId, Number(branchId), {
        limit: 200,
        ...(locationId !== '' ? { branchLocationId: Number(locationId) } : {}),
      });
      setRows(result.rows);
      setTotal(result.total);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not load activity');
    } finally {
      setBusy(false);
    }
  }, [branchId, locationId, practiceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const visibleRows = rows.filter((row) => {
    if (action && row.movementType !== action) return false;
    if (!exceptionsOnly) return true;
    const note = (row.note ?? '').toLowerCase();
    const isOverride = note.includes('zero-qoh override');
    const wentNegative =
      row.movementType === 'sold' &&
      row.fromQuantityAfter != null &&
      Number(row.fromQuantityAfter) < 0;
    return isOverride || wentNegative;
  });

  const locationLabel =
    locationId === ''
      ? null
      : locations.find((l) => l.id === locationId)?.name ?? `Location #${locationId}`;

  return (
    <div className="settings-card" style={{ maxWidth: 900, margin: '0 auto', padding: 16 }}>
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
          <h2 style={{ margin: 0 }}>Inventory Activity</h2>
          <p className="settings-muted" style={{ margin: '4px 0 0' }}>
            Immutable stock history: who did what and when.
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
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </select>
        </label>
        <label className="settings-label">
          Location
          <select
            className="settings-input"
            value={locationId}
            onChange={(e) => setLocationId(e.target.value ? Number(e.target.value) : '')}
          >
            <option value="">All locations</option>
            {locations.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.name}
              </option>
            ))}
          </select>
        </label>
        <label className="settings-label">
          Action
          <select
            className="settings-input"
            value={action}
            onChange={(e) => setAction(e.target.value)}
          >
            <option value="">All activity</option>
            {Object.entries(ACTION_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="settings-label" style={{ justifyContent: 'flex-end' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 22 }}>
            <input
              type="checkbox"
              checked={exceptionsOnly}
              onChange={(e) => setExceptionsOnly(e.target.checked)}
            />
            Exceptions only (zero-QOH overrides / negative QOH)
          </span>
        </label>
      </div>

      {locationLabel ? (
        <p className="settings-muted" style={{ margin: '0 0 12px', fontSize: 13 }}>
          Showing activity into or out of <strong>{locationLabel}</strong>.
        </p>
      ) : null}

      {error && <div className="settings-message settings-error-message">{error}</div>}
      {busy && rows.length === 0 ? (
        <p className="settings-muted">Loading activity…</p>
      ) : visibleRows.length === 0 ? (
        <p className="settings-muted">No matching activity.</p>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {visibleRows.map((row) => (
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
                  {ACTION_LABELS[String(row.movementType)] ?? row.movementType} ·{' '}
                  {row.inventoryItem?.name ?? `Item #${row.inventoryItemId}`}
                </strong>
                <time className="settings-muted">
                  {row.created ? new Date(row.created).toLocaleString() : 'Unknown time'}
                </time>
              </div>
              <div style={{ marginTop: 5 }}>
                {Number(row.quantity ?? 0)} unit{Number(row.quantity ?? 0) === 1 ? '' : 's'}
                {locationText(row) ? ` · ${locationText(row)}` : ''}
                {row.fromQuantityAfter != null
                  ? ` · QOH after ${Number(row.fromQuantityAfter)}`
                  : ''}
                {' · '}
                <strong>{actorLabel(row)}</strong>
                {(row.note ?? '').toLowerCase().includes('zero-qoh override') ||
                (row.fromQuantityAfter != null && Number(row.fromQuantityAfter) < 0) ? (
                  <span
                    style={{
                      marginLeft: 8,
                      fontSize: 11,
                      fontWeight: 700,
                      color: '#b45309',
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                    }}
                  >
                    Exception
                  </span>
                ) : null}
              </div>
              {row.note && (
                <div className="settings-muted" style={{ marginTop: 4 }}>
                  {row.note}
                </div>
              )}
            </article>
          ))}
        </div>
      )}
      {total > rows.length && (
        <p className="settings-muted" style={{ marginTop: 12 }}>
          Showing the newest {rows.length} of {total} records.
        </p>
      )}
    </div>
  );
}

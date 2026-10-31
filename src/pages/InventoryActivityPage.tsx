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
import { fetchMyOffices } from '../api/permissions';
import { INVENTORY_MOVEMENT_LABELS as ACTION_LABELS } from '../utils/inventoryMovementLabels';
import './Settings.css';

const PAGE_SIZE = 50;

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
  // The full log where someone holds it (an inventory manager's own location); controlled drugs
  // only at other offices where they hold the controlled-drug log (Controlled Substances
  // Director, veterinarians) (owner decisions, Oct 30, 2026).
  const [fullOffices, setFullOffices] = useState<number[] | 'all' | null>(null);
  const controlledLocked =
    fullOffices !== null &&
    fullOffices !== 'all' &&
    (branchId === '' || !fullOffices.includes(Number(branchId)));
  const [controlledPicked, setControlledPicked] = useState(false);
  const controlledOnly = controlledLocked || controlledPicked;
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    setPage(0);
  }, [branchId, locationId, action, exceptionsOnly, search, controlledOnly]);

  useEffect(() => {
    void Promise.all([
      listPracticeBranches(practiceId),
      // If the lookup fails, show every office and let the server decide what each one shows.
      fetchMyOffices(practiceId, 'inventory.activity_log.view').catch(() => 'all' as const),
      fetchMyOffices(practiceId, 'inventory.activity_log.controlled').catch(() => [] as number[]),
    ])
      .then(([list, full, controlled]) => {
        setFullOffices(full);
        const allowed = (id: number) =>
          full === 'all' || controlled === 'all' || full.includes(id) || controlled.includes(id);
        const active = list.filter((b) => b.isActive !== false && allowed(b.id));
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
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
        ...(locationId !== '' ? { branchLocationId: Number(locationId) } : {}),
        ...(search ? { search } : {}),
        ...(action ? { movementType: action } : {}),
        ...(exceptionsOnly ? { exceptionsOnly: true } : {}),
        ...(controlledOnly ? { controlledOnly: true } : {}),
      });
      setRows(result.rows);
      setTotal(result.total);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not load activity');
    } finally {
      setBusy(false);
    }
  }, [branchId, locationId, practiceId, page, search, action, exceptionsOnly, controlledOnly]);

  useEffect(() => {
    void load();
  }, [load]);

  const visibleRows = rows;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

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
          <h2 style={{ margin: 0 }}>
            {controlledLocked ? 'Controlled Drug Activity' : 'Inventory Activity'}
          </h2>
          <p className="settings-muted" style={{ margin: '4px 0 0' }}>
            {controlledLocked
              ? 'Every controlled drug received, moved, wasted or adjusted: who did what and when.'
              : 'Immutable stock history: who did what and when.'}
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
          Item
          <input
            className="settings-input"
            type="search"
            placeholder="Search by item name"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </label>
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
        {controlledLocked ? null : (
          <label className="settings-label" style={{ justifyContent: 'flex-end' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 22 }}>
              <input
                type="checkbox"
                checked={controlledPicked}
                onChange={(e) => setControlledPicked(e.target.checked)}
              />
              Controlled drugs only
            </span>
          </label>
        )}
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
      {total > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            marginTop: 12,
          }}
        >
          <span className="settings-muted">
            {page * PAGE_SIZE + 1}–{page * PAGE_SIZE + rows.length} of {total}
          </span>
          {pageCount > 1 ? (
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                className="btn secondary"
                type="button"
                disabled={busy || page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                Newer
              </button>
              <span className="settings-muted">
                Page {page + 1} of {pageCount}
              </span>
              <button
                className="btn secondary"
                type="button"
                disabled={busy || page + 1 >= pageCount}
                onClick={() => setPage((p) => p + 1)}
              >
                Older
              </button>
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
}

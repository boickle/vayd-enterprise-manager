import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../auth/useAuth';
import { listPracticeBranches, type PracticeBranch } from '../api/branchInventory';
import {
  patchCountLine,
  startCountSession,
  submitCountLine,
  submitCountSession,
  type StaffCountLine,
  type StaffCountLocation,
  type StaffCountSession,
} from '../api/inventoryCounts';
import { resolvePracticeIdFromToken } from '../utils/practiceIdFromToken';
import './Settings.css';

const BRANCH_STORAGE_PREFIX = 'vayd_inventory_branch:';
const UNASSIGNED_LOT = 'UNASSIGNED';

type DraftCell = {
  key: string;
  id?: number;
  branchLocationId: number;
  inventoryLotBalanceId: number | null;
  lotNumber: string;
  expirationDate: string;
  actualQty: string;
  lockedLot: boolean;
};

function parseQty(raw: string): number | null {
  const t = raw.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : Number.NaN;
}

function displayQty(qty: number | null | undefined): string {
  return qty == null || !Number.isFinite(Number(qty)) ? '—' : String(qty);
}

function lotDisplay(
  lotNumber: string | null | undefined,
  expirationDate?: string | null
): string {
  const raw = lotNumber?.trim() ?? '';
  if (raw === UNASSIGNED_LOT) return 'Existing stock (no lot recorded)';
  if (raw) return raw;
  if (expirationDate) return `Exp ${expirationDate.slice(0, 10)}`;
  return 'No lot # — expiration identifies this bottle';
}

function dateInputValue(value: string | null | undefined): string {
  if (!value) return '';
  const slice = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(slice) ? slice : '';
}

function cellsFromLine(line: StaffCountLine): DraftCell[] {
  return line.locations.map((loc, idx) => ({
    key: loc.id != null && loc.id > 0 ? `id:${loc.id}` : `tmp:${line.id}:${loc.branchLocationId}:${idx}`,
    id: loc.id != null && loc.id > 0 ? loc.id : undefined,
    branchLocationId: loc.branchLocationId,
    inventoryLotBalanceId: loc.inventoryLotBalanceId ?? null,
    lotNumber: loc.lotNumber ?? '',
    expirationDate: dateInputValue(loc.expirationDate),
    actualQty: loc.actualQty == null ? '' : String(loc.actualQty),
    lockedLot: loc.inventoryLotBalanceId != null,
  }));
}

function lineSearchText(line: StaffCountLine): string {
  return [
    line.name ?? '',
    line.code ?? '',
    ...(line.aliases ?? []),
    ...line.locations.map((loc) => loc.lotNumber ?? ''),
  ]
    .join(' ')
    .toLowerCase();
}

function lineHasCountedCells(line: StaffCountLine): boolean {
  return (line.locations ?? []).some(
    (loc) => loc.actualQty != null && Number.isFinite(Number(loc.actualQty))
  );
}

/** Draft is savable when every filled cell is a valid qty and at least one is filled. */
function draftReadyToSave(cells: DraftCell[]): boolean {
  let counted = 0;
  for (const cell of cells) {
    if (cell.actualQty.trim() === '') continue;
    const qty = parseQty(cell.actualQty);
    if (qty == null || Number.isNaN(qty)) return false;
    counted += 1;
  }
  return counted > 0;
}

function cellTotal(cells: Array<{ actualQty: string }>): number | null {
  let sum = 0;
  let any = false;
  for (const cell of cells) {
    const qty = parseQty(cell.actualQty);
    if (qty == null || Number.isNaN(qty)) continue;
    any = true;
    sum += qty;
  }
  return any ? sum : null;
}

type Props = {
  /** weekly = ABC due list (capped); full = all stock items for EOY / physical */
  kind?: 'weekly' | 'full';
};

export default function InventoryCountsPage({ kind = 'weekly' }: Props) {
  const { token } = useAuth() as { token: string | null };
  const practiceId = useMemo(() => resolvePracticeIdFromToken(token), [token]);
  const [branches, setBranches] = useState<PracticeBranch[]>([]);
  const [branchId, setBranchId] = useState<number | null>(null);
  const [session, setSession] = useState<StaffCountSession | null>(null);
  const [drafts, setDrafts] = useState<Record<number, DraftCell[]>>({});
  const [editingLineId, setEditingLineId] = useState<number | null>(null);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [savingId, setSavingId] = useState<number | null>(null);

  const isFull = kind === 'full';

  useEffect(() => {
    let cancelled = false;
    void listPracticeBranches(practiceId)
      .then((list) => {
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
        setBranchId(initial ?? active.find((b) => b.isDefault)?.id ?? active[0]?.id ?? null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load offices');
      });
    return () => {
      cancelled = true;
    };
  }, [practiceId]);

  useEffect(() => {
    if (branchId == null) {
      setSession(null);
      return;
    }
    let cancelled = false;
    setBusy(true);
    setError(null);
    setFilter('');
    setEditingLineId(null);
    void startCountSession(practiceId, branchId, kind)
      .then((next) => {
        if (cancelled) return;
        setSession(next);
        const nextDrafts: Record<number, DraftCell[]> = {};
        for (const line of next.lines) {
          nextDrafts[line.id] = cellsFromLine(line);
        }
        setDrafts(nextDrafts);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(
            e instanceof Error
              ? e.message
              : isFull
                ? 'Could not load full inventory count'
                : 'Could not load this week’s count'
          );
        }
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [practiceId, branchId, kind, isFull]);

  function applyLine(updated: StaffCountLine) {
    setSession((prev) =>
      prev
        ? { ...prev, lines: prev.lines.map((l) => (l.id === updated.id ? updated : l)) }
        : prev
    );
    setDrafts((prev) => ({ ...prev, [updated.id]: cellsFromLine(updated) }));
  }

  function locationsPayload(line: StaffCountLine) {
    const cells = drafts[line.id] ?? cellsFromLine(line);
    return cells.map((cell) => {
      const raw = cell.actualQty.trim();
      const qty = parseQty(cell.actualQty);
      if (raw !== '' && (qty == null || Number.isNaN(qty))) {
        throw new Error(`${line.name ?? 'Item'} must have a number 0 or greater`);
      }
      const lotNumber = cell.lotNumber.trim();
      return {
        ...(cell.id != null ? { id: cell.id } : {}),
        branchLocationId: cell.branchLocationId,
        inventoryLotBalanceId: cell.inventoryLotBalanceId,
        lotNumber: lotNumber || null,
        expirationDate: cell.expirationDate.trim() || null,
        actualQty: raw === '' ? null : qty,
      };
    });
  }

  function beginEdit(line: StaffCountLine) {
    if (line.submitted || busy) return;
    setDrafts((prev) => ({ ...prev, [line.id]: cellsFromLine(line) }));
    setEditingLineId(line.id);
    setError(null);
  }

  function cancelEdit(line: StaffCountLine) {
    setDrafts((prev) => ({ ...prev, [line.id]: cellsFromLine(line) }));
    setEditingLineId(null);
    setError(null);
  }

  function addLotRow(line: StaffCountLine, branchLocationId: number) {
    setDrafts((prev) => {
      const cur = prev[line.id] ?? cellsFromLine(line);
      return {
        ...prev,
        [line.id]: [
          ...cur,
          {
            key: `new:${line.id}:${branchLocationId}:${Date.now()}`,
            branchLocationId,
            inventoryLotBalanceId: null,
            lotNumber: '',
            expirationDate: '',
            actualQty: '',
            lockedLot: false,
          },
        ],
      };
    });
  }

  function updateCell(lineId: number, key: string, patch: Partial<DraftCell>) {
    setDrafts((prev) => ({
      ...prev,
      [lineId]: (prev[lineId] ?? []).map((cell) =>
        cell.key === key ? { ...cell, ...patch } : cell
      ),
    }));
  }

  function removeCell(lineId: number, key: string) {
    setDrafts((prev) => {
      const cur = prev[lineId] ?? [];
      const target = cur.find((c) => c.key === key);
      if (!target || target.lockedLot) return prev;
      const atLoc = cur.filter((c) => c.branchLocationId === target.branchLocationId);
      if (atLoc.length <= 1) return prev;
      return { ...prev, [lineId]: cur.filter((c) => c.key !== key) };
    });
  }

  async function saveLine(line: StaffCountLine) {
    if (!session) return;
    const cells = drafts[line.id] ?? cellsFromLine(line);
    if (!draftReadyToSave(cells)) {
      setError('Enter a count for at least one location before saving.');
      return;
    }
    setSavingId(line.id);
    setError(null);
    try {
      const locations = locationsPayload(line);
      const saved = await patchCountLine(practiceId, session.id, line.id, locations);
      applyLine(saved);
      setEditingLineId(null);
      setToast(`Saved counts for ${line.name ?? 'item'} (not posted to inventory yet)`);
      window.setTimeout(() => setToast(null), 2800);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not save count');
    } finally {
      setSavingId(null);
    }
  }

  async function submitLine(line: StaffCountLine) {
    if (!session || !lineHasCountedCells(line)) return;
    setSavingId(line.id);
    setError(null);
    try {
      const result = await submitCountLine(practiceId, session.id, line.id);
      applyLine(result.line);
      if (result.sessionStatus === 'submitted') {
        setSession((prev) => (prev ? { ...prev, status: 'submitted' } : prev));
      }
      setEditingLineId(null);
      setToast(`Posted count for ${line.name ?? 'item'} — on-hand updated`);
      window.setTimeout(() => setToast(null), 2800);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not submit count');
    } finally {
      setSavingId(null);
    }
  }

  async function submitReadySheet() {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      const next = await submitCountSession(practiceId, session.id);
      setSession(next);
      setEditingLineId(null);
      setToast(
        next.submittedCount
          ? `Posted ${next.submittedCount} item${next.submittedCount === 1 ? '' : 's'} to inventory`
          : 'No items ready. Save a count for at least one location on an item first.'
      );
      window.setTimeout(() => setToast(null), 3500);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not submit counts');
    } finally {
      setBusy(false);
    }
  }

  const filterLower = filter.trim().toLowerCase();
  const visibleLines = useMemo(() => {
    const lines = session?.lines ?? [];
    if (!filterLower) return lines;
    return lines.filter((line) => lineSearchText(line).includes(filterLower));
  }, [session?.lines, filterLower]);

  const readyToPost = (session?.lines ?? []).filter(
    (line) => !line.submitted && lineHasCountedCells(line)
  ).length;
  const doneCount = session?.lines.filter((l) => l.submitted).length ?? 0;
  const totalCount = session?.lines.length ?? 0;

  return (
    <div className="settings-section">
      <p className="settings-section-description">
        {isFull
          ? 'Full inventory: count each lot at each location you check (how many of this dated bottle are on this shelf). Leave other locations blank to leave their on-hand unchanged. Lot # and expiration come from inventory; Count is what you enter (not the catalog QOH — that stays hidden so this is a blind count). Submit posts counted locations only.'
          : 'Weekly list to count: due A/B/C items (capped at 20). Lot # and expiration come from inventory; Count is blank until you enter what you see on the shelf (catalog QOH is hidden on purpose). Leave unchecked locations blank. Submit posts counted locations only.'}
      </p>
      <div
        style={{
          display: 'flex',
          gap: 12,
          flexWrap: 'wrap',
          alignItems: 'center',
          marginBottom: 12,
        }}
      >
        <span className="settings-muted" style={{ fontSize: 13 }}>
          List
        </span>
        {isFull ? (
          <>
            <strong style={{ fontSize: 13 }}>Full count (all items)</strong>
            <Link to="/schedule/inventory/counts" className="btn secondary" style={{ fontSize: 13 }}>
              Weekly count list
            </Link>
          </>
        ) : (
          <>
            <strong style={{ fontSize: 13 }}>Weekly count list</strong>
            <Link
              to="/schedule/inventory/full-count"
              className="btn secondary"
              style={{ fontSize: 13 }}
              title="One-time physical count of every stock item before go-live"
            >
              Full count list
            </Link>
          </>
        )}
      </div>
      {toast && (
        <div className="settings-message settings-success-message" style={{ marginBottom: 12 }}>
          {toast}
        </div>
      )}
      {error && (
        <div className="settings-message settings-error-message" style={{ marginBottom: 12 }}>
          {error}
        </div>
      )}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16, alignItems: 'end' }}>
        <label className="settings-label">
          Office
          <select
            className="settings-input"
            style={{ minWidth: 260 }}
            value={branchId ?? ''}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (!Number.isFinite(v)) return;
              setBranchId(v);
              try {
                localStorage.setItem(`${BRANCH_STORAGE_PREFIX}${practiceId}`, String(v));
              } catch {
                /* ignore */
              }
            }}
          >
            {!branches.length && <option value="">No offices</option>}
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
                {b.isDefault ? ' (default)' : ''}
              </option>
            ))}
          </select>
        </label>
        {session && session.lines.length > 0 && (
          <label className="settings-label">
            Find item
            <input
              className="settings-input"
              style={{ minWidth: 220 }}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Name, code, charge name, or lot"
            />
          </label>
        )}
        {session && totalCount > 0 && (
          <span className="settings-muted" style={{ alignSelf: 'center' }}>
            {doneCount} of {totalCount} posted
            {readyToPost > 0 ? ` · ${readyToPost} ready to submit` : ''}
          </span>
        )}
        {session && session.status === 'open' && (
          <button
            type="button"
            className="btn primary"
            disabled={busy || readyToPost === 0 || editingLineId != null}
            onClick={() => void submitReadySheet()}
            title={
              editingLineId != null
                ? 'Save or cancel the row you are editing first'
                : readyToPost === 0
                  ? 'Save a count for at least one location on an item before submitting'
                  : 'Post all items that already have at least one location counted'
            }
          >
            Submit ready items ({readyToPost})
          </button>
        )}
      </div>
      {busy && !session && (
        <p className="settings-muted">
          {isFull ? 'Loading all items…' : 'Loading weekly list…'}
        </p>
      )}
      {session && session.lines.length === 0 && (
        <p className="settings-muted">
          {isFull
            ? 'No active stock items to count.'
            : 'Nothing is due to count at this office this week.'}
        </p>
      )}
      {session && session.lines.length > 0 && visibleLines.length === 0 && (
        <p className="settings-muted">No items match “{filter.trim()}”.</p>
      )}
      {session && visibleLines.length > 0 && (
        <div className="settings-table-container">
          <table className="settings-table par-levels-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Location</th>
                <th>Lot</th>
                <th>Exp</th>
                <th>Count</th>
                <th>Total</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visibleLines.map((line) => {
                const editing = editingLineId === line.id;
                const cells = editing ? drafts[line.id] ?? cellsFromLine(line) : null;
                const displayCells: Array<StaffCountLocation | DraftCell> = editing
                  ? cells ?? []
                  : line.locations;
                const rowCount = Math.max(displayCells.length, 1);
                const savedTotal = lineHasCountedCells(line) && !editing
                    ? line.locations.reduce(
                        (sum, loc) =>
                          loc.actualQty != null && Number.isFinite(Number(loc.actualQty))
                            ? sum + Number(loc.actualQty)
                            : sum,
                        0
                      )
                    : null;
                const draftTotal = editing && cells ? cellTotal(cells) : null;
                const canSubmit = !line.submitted && !editing && lineHasCountedCells(line);
                const itemHref = `/schedule/inventory/items?itemId=${line.inventoryItemId}${
                  line.name ? `&name=${encodeURIComponent(line.name)}` : ''
                }`;
                const locName = (id: number) =>
                  session.locations.find((l) => l.id === id)?.name ?? `Location #${id}`;

                return displayCells.map((cell, idx) => {
                  const draft = editing ? (cell as DraftCell) : null;
                  const saved = !editing ? (cell as StaffCountLocation) : null;
                  const locId = draft?.branchLocationId ?? saved?.branchLocationId ?? 0;
                  return (
                    <tr key={`${line.id}:${draft?.key ?? saved?.id ?? idx}`}>
                      {idx === 0 && (
                        <td rowSpan={rowCount} style={{ verticalAlign: 'top' }}>
                          <Link
                            to={itemHref}
                            style={{ fontWeight: 600, color: 'inherit', textDecoration: 'underline' }}
                          >
                            {line.name ?? `Item #${line.inventoryItemId}`}
                          </Link>
                          {line.code ? (
                            <div className="settings-muted" style={{ fontSize: 12 }}>
                              {line.code}
                            </div>
                          ) : null}
                          {line.aliases && line.aliases.length > 0 ? (
                            <div className="settings-muted" style={{ fontSize: 12 }}>
                              Also: {line.aliases.slice(0, 4).join(', ')}
                              {line.aliases.length > 4 ? '…' : ''}
                            </div>
                          ) : null}
                          {line.submitted ? (
                            <div className="settings-muted" style={{ fontSize: 12 }}>
                              Posted to inventory
                            </div>
                          ) : null}
                          {editing ? (
                            <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                              {(session.locations ?? []).map((loc) => (
                                <button
                                  key={loc.id}
                                  type="button"
                                  className="btn secondary"
                                  style={{ fontSize: 12, padding: '4px 8px' }}
                                  disabled={busy || savingId === line.id}
                                  onClick={() => addLotRow(line, loc.id)}
                                >
                                  Add lot at {loc.name}
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </td>
                      )}
                      <td>{locName(locId)}</td>
                      <td>
                        {editing && draft && !draft.lockedLot ? (
                          <input
                            className="settings-input par-levels-input"
                            value={draft.lotNumber}
                            disabled={busy || savingId === line.id}
                            placeholder="Lot # (optional)"
                            required={line.requireLotNumber === true}
                            aria-label={`${line.name ?? 'Item'} lot`}
                            onChange={(e) =>
                              updateCell(line.id, draft.key, { lotNumber: e.target.value })
                            }
                          />
                        ) : (
                          lotDisplay(
                            draft?.lotNumber ?? saved?.lotNumber,
                            draft?.expirationDate ?? saved?.expirationDate
                          )
                        )}
                      </td>
                      <td>
                        {editing && draft && !draft.lockedLot ? (
                          <input
                            className="settings-input par-levels-input"
                            type="date"
                            value={draft.expirationDate}
                            disabled={busy || savingId === line.id}
                            required={draft.lotNumber.trim() !== UNASSIGNED_LOT}
                            aria-label={`${line.name ?? 'Item'} expiration`}
                            onChange={(e) =>
                              updateCell(line.id, draft.key, { expirationDate: e.target.value })
                            }
                          />
                        ) : (
                          dateInputValue(draft?.expirationDate ?? saved?.expirationDate) || '—'
                        )}
                      </td>
                      <td>
                        {editing && draft ? (
                          <input
                            className="settings-input par-levels-input"
                            inputMode="decimal"
                            disabled={busy || savingId === line.id}
                            value={draft.actualQty}
                            onChange={(e) =>
                              updateCell(line.id, draft.key, { actualQty: e.target.value })
                            }
                            placeholder="—"
                            aria-label={`${line.name ?? 'Item'} ${locName(locId)} count`}
                          />
                        ) : saved?.actualQty != null ? (
                          displayQty(saved.actualQty)
                        ) : (
                          <span className="settings-muted" title="Enter what you count on the shelf">
                            enter count
                          </span>
                        )}
                        {editing &&
                        draft &&
                        !draft.lockedLot &&
                        (cells ?? []).filter((c) => c.branchLocationId === locId).length > 1 ? (
                          <button
                            type="button"
                            className="btn secondary"
                            style={{ fontSize: 12, padding: '4px 8px', marginTop: 6, display: 'block' }}
                            disabled={busy || savingId === line.id}
                            onClick={() => removeCell(line.id, draft.key)}
                          >
                            Remove
                          </button>
                        ) : null}
                      </td>
                      {idx === 0 && (
                        <>
                          <td rowSpan={rowCount} style={{ verticalAlign: 'top' }}>
                            {editing
                              ? draftTotal != null
                                ? draftTotal
                                : <span className="settings-muted">—</span>
                              : savedTotal != null
                                ? savedTotal
                                : <span className="settings-muted">—</span>}
                          </td>
                          <td rowSpan={rowCount} style={{ verticalAlign: 'top' }}>
                            {!line.submitted && (
                              <div className="par-row-actions par-row-actions--stack">
                                {editing ? (
                                  <>
                                    <button
                                      type="button"
                                      className="btn primary"
                                      disabled={
                                        savingId === line.id ||
                                        busy ||
                                        !(cells && draftReadyToSave(cells))
                                      }
                                      onClick={() => void saveLine(line)}
                                    >
                                      {savingId === line.id ? 'Saving…' : 'Save'}
                                    </button>
                                    <button
                                      type="button"
                                      className="btn secondary"
                                      disabled={savingId === line.id || busy}
                                      onClick={() => cancelEdit(line)}
                                    >
                                      Cancel
                                    </button>
                                  </>
                                ) : (
                                  <>
                                    <button
                                      type="button"
                                      className="btn secondary"
                                      disabled={busy || (editingLineId != null && editingLineId !== line.id)}
                                      onClick={() => beginEdit(line)}
                                    >
                                      Edit
                                    </button>
                                    <button
                                      type="button"
                                      className="btn primary"
                                      disabled={savingId === line.id || busy || !canSubmit}
                                      title={
                                        canSubmit
                                          ? 'Post this item’s counted locations to on-hand (blank locations stay unchanged)'
                                          : 'Save a count for at least one location before submitting'
                                      }
                                      onClick={() => void submitLine(line)}
                                    >
                                      {savingId === line.id ? 'Submitting…' : 'Submit'}
                                    </button>
                                  </>
                                )}
                              </div>
                            )}
                          </td>
                        </>
                      )}
                    </tr>
                  );
                });
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

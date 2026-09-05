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
  type StaffCountSession,
} from '../api/inventoryCounts';
import { resolvePracticeIdFromToken } from '../utils/practiceIdFromToken';
import './Settings.css';

const BRANCH_STORAGE_PREFIX = 'vayd_inventory_branch:';

function parseQty(raw: string): number | null {
  const t = raw.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : Number.NaN;
}

function lineFullyCounted(line: StaffCountLine): boolean {
  return (
    line.locations.length > 0 &&
    line.locations.every((loc) => loc.actualQty != null && Number.isFinite(Number(loc.actualQty)))
  );
}

function displayQty(qty: number | null | undefined): string {
  return qty == null || !Number.isFinite(Number(qty)) ? '—' : String(qty);
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
  const [drafts, setDrafts] = useState<Record<string, string>>({});
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
        const nextDrafts: Record<string, string> = {};
        for (const line of next.lines) {
          for (const loc of line.locations) {
            nextDrafts[`${line.id}:${loc.branchLocationId}`] =
              loc.actualQty == null ? '' : String(loc.actualQty);
          }
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
    setDrafts((prev) => {
      const next = { ...prev };
      for (const loc of updated.locations) {
        next[`${updated.id}:${loc.branchLocationId}`] =
          loc.actualQty == null ? '' : String(loc.actualQty);
      }
      return next;
    });
  }

  function locationsPayload(line: StaffCountLine) {
    return line.locations.map((loc) => {
      const raw = drafts[`${line.id}:${loc.branchLocationId}`] ?? '';
      const qty = parseQty(raw);
      if (Number.isNaN(qty)) {
        throw new Error(`${line.name ?? 'Item'} ${loc.name} must be a number 0 or greater`);
      }
      return { branchLocationId: loc.branchLocationId, actualQty: qty };
    });
  }

  function beginEdit(line: StaffCountLine) {
    if (line.submitted || busy) return;
    const nextDrafts = { ...drafts };
    for (const loc of line.locations) {
      nextDrafts[`${line.id}:${loc.branchLocationId}`] =
        loc.actualQty == null ? '' : String(loc.actualQty);
    }
    setDrafts(nextDrafts);
    setEditingLineId(line.id);
    setError(null);
  }

  function cancelEdit(line: StaffCountLine) {
    setDrafts((prev) => {
      const next = { ...prev };
      for (const loc of line.locations) {
        next[`${line.id}:${loc.branchLocationId}`] =
          loc.actualQty == null ? '' : String(loc.actualQty);
      }
      return next;
    });
    setEditingLineId(null);
    setError(null);
  }

  async function saveLine(line: StaffCountLine) {
    if (!session) return;
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
    if (!session || !lineFullyCounted(line)) return;
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
          : 'No items ready. Save a count for every location on an item first.'
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
    return lines.filter((line) => {
      const name = (line.name ?? '').toLowerCase();
      const code = (line.code ?? '').toLowerCase();
      return name.includes(filterLower) || code.includes(filterLower);
    });
  }, [session?.lines, filterLower]);

  const readyToPost = (session?.lines ?? []).filter(
    (line) => !line.submitted && lineFullyCounted(line)
  ).length;
  const doneCount = session?.lines.filter((l) => l.submitted).length ?? 0;
  const totalCount = session?.lines.length ?? 0;

  return (
    <div className="settings-section">
      <p className="settings-section-description">
        {isFull
          ? 'Full inventory: every active stock item. Edit a row to enter counts, then Save. Different people can fill different locations. Submit posts an item to on-hand only after every location for that item has a saved count.'
          : 'Weekly list to count: due A/B/C items (capped at 20). Edit a row to enter counts, then Save. Different people can fill different locations. Submit posts an item to on-hand only after every location for that item has a saved count. System quantity stays hidden until you submit.'}
      </p>
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
        {isFull && session && session.lines.length > 0 && (
          <label className="settings-label">
            Find item
            <input
              className="settings-input"
              style={{ minWidth: 220 }}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Name or code"
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
                  ? 'Save a count for every location on an item before submitting'
                  : 'Post all items that already have every location counted'
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
                {(session.locations ?? []).map((loc) => (
                  <th key={loc.id}>{loc.name}</th>
                ))}
                <th>Total</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visibleLines.map((line) => {
                const editing = editingLineId === line.id;
                const savedTotal =
                  lineFullyCounted(line) && !editing
                    ? line.locations.reduce((sum, loc) => sum + Number(loc.actualQty), 0)
                    : null;
                const draftTotal = editing
                  ? line.locations.reduce((sum, loc) => {
                      const qty = parseQty(drafts[`${line.id}:${loc.branchLocationId}`] ?? '');
                      return qty != null && !Number.isNaN(qty) ? sum + qty : sum;
                    }, 0)
                  : null;
                const draftAllIn =
                  editing &&
                  line.locations.every((loc) => {
                    const qty = parseQty(drafts[`${line.id}:${loc.branchLocationId}`] ?? '');
                    return qty != null && !Number.isNaN(qty);
                  });
                const canSubmit = !line.submitted && !editing && lineFullyCounted(line);
                const itemHref = `/schedule/inventory/items?itemId=${line.inventoryItemId}${
                  line.name
                    ? `&name=${encodeURIComponent(line.name)}`
                    : ''
                }`;

                return (
                  <tr key={line.id}>
                    <td>
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
                      {line.submitted ? (
                        <div className="settings-muted" style={{ fontSize: 12 }}>
                          Posted to inventory
                        </div>
                      ) : null}
                    </td>
                    {line.locations.map((loc) => {
                      const key = `${line.id}:${loc.branchLocationId}`;
                      if (editing) {
                        return (
                          <td key={loc.branchLocationId}>
                            <input
                              className="settings-input par-levels-input"
                              inputMode="decimal"
                              disabled={busy || savingId === line.id}
                              value={drafts[key] ?? ''}
                              onChange={(e) =>
                                setDrafts((prev) => ({
                                  ...prev,
                                  [key]: e.target.value,
                                }))
                              }
                              placeholder="—"
                              aria-label={`${line.name ?? 'Item'} ${loc.name}`}
                            />
                          </td>
                        );
                      }
                      return (
                        <td key={loc.branchLocationId}>
                          <span aria-label={`${line.name ?? 'Item'} ${loc.name}`}>
                            {displayQty(loc.actualQty)}
                          </span>
                        </td>
                      );
                    })}
                    <td>
                      {editing
                        ? draftAllIn
                          ? draftTotal
                          : <span className="settings-muted">—</span>
                        : savedTotal != null
                          ? savedTotal
                          : <span className="settings-muted">—</span>}
                    </td>
                    <td>
                      {!line.submitted && (
                        <div className="par-row-actions">
                          {editing ? (
                            <>
                              <button
                                type="button"
                                className="btn primary"
                                disabled={savingId === line.id || busy}
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
                                    ? 'Post this item’s counts to on-hand'
                                    : 'Save a count for every location before submitting'
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
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

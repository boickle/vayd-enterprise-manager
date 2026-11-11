import { useEffect, useState } from 'react';
import { searchItems } from '../../api/roomLoader';
import { addWeeklyCountItems, type AddWeeklyCountItemsResult } from '../../api/inventoryCounts';
import { apiErrorMessage } from '../../api/http';

type CatalogPick = { id: number; name: string; code: string | null };

type Props = {
  open: boolean;
  practiceId: number;
  branchId: number;
  branchName: string;
  /** Inventory item ids already on this week's sheet, so search can say so. */
  onSheetItemIds: number[];
  onClose: () => void;
  onAdded: (result: AddWeeklyCountItemsResult) => void;
};

const QUICK_DUE = 10;

/** Plain-language result of an add, for the page's toast. */
export function addedSummary(
  r: Pick<AddWeeklyCountItemsResult, 'added' | 'alreadyOnSheet' | 'notCountable'>
): string {
  const parts: string[] = [];
  if (r.added > 0 || !r.alreadyOnSheet) parts.push(`Added ${r.added} item${r.added === 1 ? '' : 's'} to the weekly count`);
  if (r.alreadyOnSheet) {
    // Nothing new to add: say it will be counted, not "Added 0" (which reads like a failure).
    if (r.added > 0) parts.push(`${r.alreadyOnSheet} already on it`);
    else if (r.alreadyOnSheet === 1) parts.push("Already on this week's count, so it will be counted there");
    else parts.push(`All ${r.alreadyOnSheet} already on this week's count, so they will be counted there`);
  }
  if (r.notCountable) parts.push(`${r.notCountable} not a countable stock item`);
  return parts.join(' · ');
}

/**
 * Admins and practice managers: put items on an office's weekly count by hand, on top of the
 * items the system picks each Monday. Pick items from the catalog, add the next N due, or both.
 */
export default function AddToWeeklyCountModal({
  open,
  practiceId,
  branchId,
  branchName,
  onSheetItemIds,
  onClose,
  onAdded,
}: Props) {
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<CatalogPick[]>([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<CatalogPick[]>([]);
  const [nextDue, setNextDue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setMatches([]);
    setPicked([]);
    setNextDue('');
    setError(null);
  }, [open, branchId]);

  useEffect(() => {
    if (!open || query.trim().length < 2) {
      setMatches([]);
      return;
    }
    const q = query.trim();
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setSearching(true);
      void searchItems({ q, practiceId, limit: 15 })
        .then((rows) => {
          if (cancelled) return;
          const next: CatalogPick[] = [];
          const seen = new Set<number>();
          for (const row of rows) {
            if (row.itemType !== 'inventory') continue;
            const id = Number(row.inventoryItem?.id);
            if (!Number.isFinite(id) || seen.has(id)) continue;
            seen.add(id);
            next.push({ id, name: row.name, code: row.code ?? row.inventoryItem?.code ?? null });
          }
          setMatches(next);
        })
        .catch(() => {
          if (!cancelled) setMatches([]);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, query, practiceId]);

  if (!open) return null;

  const onSheet = new Set(onSheetItemIds);
  const pickedIds = new Set(picked.map((p) => p.id));
  const dueCount = nextDue.trim() === '' ? 0 : Number(nextDue);
  const dueValid =
    nextDue.trim() === '' || (Number.isInteger(dueCount) && dueCount >= 0 && dueCount <= 200);
  const canAdd = !busy && dueValid && (picked.length > 0 || dueCount > 0);

  async function submit(body: { inventoryItemIds?: number[]; nextDue?: number }) {
    setBusy(true);
    setError(null);
    try {
      const result = await addWeeklyCountItems(practiceId, branchId, body);
      onAdded(result);
      onClose();
    } catch (e: unknown) {
      setError(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="settings-modal-overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-weekly-count-title"
      >
        <div className="settings-modal-header">
          <h3 id="add-weekly-count-title">Add to weekly count · {branchName}</h3>
          <button
            type="button"
            className="settings-modal-close"
            aria-label="Close"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div className="settings-modal-body">
          <p style={{ marginTop: 0 }}>
            These go on this week&rsquo;s count at {branchName}, on top of the items the system
            picks each Monday. No task is sent; counters see them on the list.
          </p>
          {error ? (
            <div className="settings-message settings-error-message" style={{ marginBottom: 10 }}>
              {error}
            </div>
          ) : null}
          <button
            type="button"
            className="btn secondary"
            disabled={busy}
            onClick={() => void submit({ nextDue: QUICK_DUE })}
            title="The next items due, in A/B/C order: never counted first, then A, B, C"
          >
            Add next {QUICK_DUE} due
          </button>
          <label className="settings-label" style={{ marginTop: 14 }}>
            Or pick items
            <input
              className="settings-input"
              value={query}
              placeholder="Search inventory by name or code"
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          {searching ? (
            <p className="settings-muted" style={{ margin: '6px 0 0', fontSize: 13 }}>
              Searching…
            </p>
          ) : null}
          {matches.length > 0 ? (
            <ul
              style={{
                listStyle: 'none',
                margin: '8px 0 0',
                padding: 0,
                border: '1px solid var(--border, #e5e7eb)',
                borderRadius: 8,
                maxHeight: 200,
                overflow: 'auto',
              }}
            >
              {matches.map((match) => {
                const already = onSheet.has(match.id);
                const chosen = pickedIds.has(match.id);
                return (
                  <li key={match.id}>
                    <button
                      type="button"
                      className="btn secondary"
                      style={{ width: '100%', textAlign: 'left', borderRadius: 0 }}
                      disabled={already || chosen}
                      onClick={() => setPicked((prev) => [...prev, match])}
                    >
                      {match.name}
                      {match.code ? <span className="settings-muted"> · {match.code}</span> : null}
                      {already ? (
                        <span className="settings-muted">
                          {' '}
                          · already on this week&rsquo;s count
                        </span>
                      ) : null}
                      {chosen ? <span className="settings-muted"> · picked</span> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
          {picked.length > 0 ? (
            <div style={{ marginTop: 10 }}>
              <div className="settings-muted" style={{ fontSize: 13, marginBottom: 4 }}>
                Picked ({picked.length})
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {picked.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="btn secondary"
                    style={{ fontSize: 12, padding: '4px 8px' }}
                    onClick={() => setPicked((prev) => prev.filter((x) => x.id !== p.id))}
                    aria-label={`Remove ${p.name}`}
                    title="Remove"
                  >
                    {p.name} ×
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <label className="settings-label" style={{ marginTop: 14 }}>
            Also add the next due items
            <input
              className="settings-input"
              type="number"
              min={0}
              max={200}
              step={1}
              inputMode="numeric"
              value={nextDue}
              placeholder="0"
              onChange={(e) => setNextDue(e.target.value)}
              style={{ maxWidth: 120 }}
              aria-label="How many of the next due items to add"
            />
          </label>
          {!dueValid ? (
            <p style={{ margin: '4px 0 0', fontSize: 12, color: '#b91c1c' }}>
              Enter a whole number from 0 to 200.
            </p>
          ) : null}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
            <button type="button" className="btn secondary" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button
              type="button"
              className="btn primary"
              disabled={!canAdd}
              onClick={() =>
                void submit({
                  ...(picked.length ? { inventoryItemIds: picked.map((p) => p.id) } : {}),
                  ...(dueCount > 0 ? { nextDue: dueCount } : {}),
                })
              }
            >
              {busy ? 'Adding…' : 'Add to weekly count'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

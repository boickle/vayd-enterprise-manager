import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../auth/useAuth';
import {
  keepInventoryLinkReleaseOnItself,
  listInventoryLinkReleases,
  type InventoryLinkRelease,
} from '../../api/branchInventory';
import { patchCatalogItem } from '../../api/catalogItems';
import { searchItems, type SearchResultItem } from '../../api/quantityPriceBreaks';
import { resolvePracticeIdFromToken } from '../../utils/practiceIdFromToken';

function errorText(err: unknown): string {
  const e = err as { response?: { data?: { message?: unknown } }; message?: string };
  const msg = e?.response?.data?.message;
  if (Array.isArray(msg)) return msg.join(', ');
  return typeof msg === 'string' ? msg : (e?.message ?? 'Could not save');
}

/**
 * Items whose stock item was deleted in eVet. Each one stays listed until it is pointed at
 * another stock item or confirmed to draw on itself.
 */
export default function ReleasedStockLinksNotice() {
  const { token } = useAuth();
  const practiceId = useMemo(() => resolvePracticeIdFromToken(token), [token]);
  const [releases, setReleases] = useState<InventoryLinkRelease[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!practiceId) return;
    try {
      setReleases(await listInventoryLinkReleases(practiceId));
    } catch {
      /* the notice is advisory; the page works without it */
    }
  }, [practiceId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (!practiceId || releases.length === 0) return null;

  const count = releases.length;
  return (
    <div
      className="settings-card"
      style={{ padding: 12, marginBottom: 12, borderLeft: '4px solid #d97706' }}
    >
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <strong style={{ flex: '1 1 auto' }}>
          {count} {count === 1 ? 'item needs' : 'items need'} a stock item: the stock item{' '}
          {count === 1 ? 'it drew' : 'they drew'} from was deleted in eVet.
        </strong>
        <button type="button" className="btn secondary" onClick={() => setOpen((v) => !v)}>
          {open ? 'Hide' : 'Review'}
        </button>
      </div>
      {open && (
        <>
          <p className="settings-muted" style={{ margin: '8px 0' }}>
            Until you choose, each item draws stock on itself. Pick the stock item it should draw
            from, or confirm it draws on itself. Changing the link in eVet works too.
          </p>
          {error && (
            <div className="settings-message settings-error-message" style={{ marginBottom: 8 }}>
              {error}
            </div>
          )}
          <table className="settings-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Drew from (deleted)</th>
                <th>Draw from</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {releases.map((release) => (
                <ReleaseRow
                  key={release.id}
                  practiceId={practiceId}
                  release={release}
                  onDone={() => {
                    setError(null);
                    void reload();
                  }}
                  onError={setError}
                />
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

function ReleaseRow({
  practiceId,
  release,
  onDone,
  onError,
}: {
  practiceId: number;
  release: InventoryLinkRelease;
  onDone: () => void;
  onError: (message: string) => void;
}) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const rows = await searchItems(term, practiceId, 25, { includeInactive: true });
        if (cancelled) return;
        setResults(
          rows.filter(
            (r) =>
              r.itemType === 'inventory' &&
              r.inventoryItem &&
              r.inventoryItem.isDeleted !== true &&
              r.inventoryItem.linkedInventoryItemId == null &&
              !(release.itemType === 'inventory' && r.inventoryItem.id === release.itemId)
          )
        );
      } catch {
        if (!cancelled) setResults([]);
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [q, practiceId, release.itemType, release.itemId]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    try {
      await action();
      onDone();
    } catch (err) {
      onError(`${release.itemName}: ${errorText(err)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr>
      <td>
        {release.itemName}
        {release.itemType !== 'inventory' && (
          <span className="settings-muted"> ({release.itemType})</span>
        )}
      </td>
      <td className="settings-muted">{release.formerStockItemName}</td>
      <td style={{ minWidth: 260 }}>
        <input
          className="settings-input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search stock items"
          disabled={busy}
        />
        {results.length > 0 && (
          <ul style={{ listStyle: 'none', padding: 0, margin: '4px 0 0' }}>
            {results.slice(0, 8).map((r) => (
              <li key={r.inventoryItem!.id}>
                <button
                  type="button"
                  className="btn secondary"
                  style={{ width: '100%', textAlign: 'left', marginBottom: 4 }}
                  disabled={busy}
                  onClick={() =>
                    void run(() =>
                      patchCatalogItem(release.itemType, practiceId, release.itemId, {
                        linkedInventoryItemId: r.inventoryItem!.id,
                      })
                    )
                  }
                >
                  {r.name}
                  {r.inventoryItem!.isActive === false && (
                    <span className="settings-muted"> (inactive)</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </td>
      <td>
        <button
          type="button"
          className="btn secondary"
          disabled={busy}
          onClick={() => void run(() => keepInventoryLinkReleaseOnItself(practiceId, release.id))}
        >
          Draw on itself
        </button>
      </td>
    </tr>
  );
}

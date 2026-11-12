import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth/useAuth';
import {
  createStoreCategory,
  deleteStoreCategory,
  listStoreCategories,
  patchStoreCategory,
  syncStoreCategoriesFromEcwid,
  type StoreCategory,
} from '../api/onlineStore';
import { apiErrorMessage } from '../api/http';
import './Settings.css';
import { currentPracticeId } from '../utils/practiceIdFromToken';

function practiceIdFromToken(token: string | null): number {
  try {
    if (!token) return currentPracticeId();
    const p = JSON.parse(atob(token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/')));
    return Number(p.practiceId ?? p.practice_id) || 1;
  } catch {
    return 1;
  }
}

export default function StoreCategoriesPage() {
  const { token } = useAuth() as { token: string | null };
  const practiceId = useMemo(() => practiceIdFromToken(token), [token]);
  const [rows, setRows] = useState<StoreCategory[]>([]);
  const [name, setName] = useState('');
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<StoreCategory | null>(null);
  const [moveTo, setMoveTo] = useState('');

  const reload = () =>
    listStoreCategories(practiceId)
      .then(setRows)
      .catch((e) => setError(apiErrorMessage(e)));

  useEffect(() => {
    void reload();
  }, [practiceId]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await fn();
      await reload();
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="settings-section">
      <p className="settings-section-description">
        These are the shop categories on the online pharmacy — the same idea as
        Ecwid (Flea &amp; Tick, Heartworm, and so on). Copy them from the Ecwid
        import, then add or rename as you like. Assign a category on each store
        item so the public shop can browse by group. Renaming a category moves its
        products and subcategories with it.
      </p>
      {error ? (
        <div className="settings-message settings-error-message">{error}</div>
      ) : null}
      {note ? (
        <div className="settings-message settings-success-message">{note}</div>
      ) : null}
      <div className="mail-queue__actions" style={{ marginBottom: 16 }}>
        <label className="settings-label">
          New category
          <input
            className="settings-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Heartworm / Chewables"
          />
        </label>
        <button
          type="button"
          className="btn primary"
          disabled={busy || !name.trim()}
          onClick={() =>
            void run(async () => {
              await createStoreCategory(practiceId, name.trim());
              setName('');
            })
          }
        >
          Add category
        </button>
        <button
          type="button"
          className="btn secondary"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const result = await syncStoreCategoriesFromEcwid(practiceId);
              setNote(
                result.added
                  ? `Copied ${result.added} categor${result.added === 1 ? 'y' : 'ies'} from Ecwid.`
                  : `All ${result.total} Ecwid categor${result.total === 1 ? 'y is' : 'ies are'} already here.`,
              );
            })
          }
        >
          Copy from Ecwid
        </button>
      </div>
      <table className="settings-table">
        <thead>
          <tr>
            <th>Category</th>
            <th>Source</th>
            <th>Products</th>
            <th>On the shop</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.id}:${row.name}`}>
              <td>
                {row.id ? (
                  <input
                    className="settings-input"
                    value={edits[row.id] ?? row.name}
                    onChange={(e) =>
                      setEdits((prev) => ({ ...prev, [row.id]: e.target.value }))
                    }
                    onBlur={() => {
                      const next = (edits[row.id] ?? row.name).trim();
                      if (!next || next === row.name) return;
                      void run(async () => {
                        await patchStoreCategory(practiceId, row.id, { name: next });
                      });
                    }}
                  />
                ) : (
                  row.name
                )}
              </td>
              <td>{row.source === 'ecwid' ? 'Ecwid' : 'Added here'}</td>
              <td>{row.productCount}</td>
              <td>
                {row.hidden ? (
                  <span className="store-category-status is-hidden">Hidden</span>
                ) : row.productCount > 0 ? (
                  <span className="store-category-status is-shown">Shown</span>
                ) : (
                  <span
                    className="store-category-status"
                    title="A category shows on the shop once at least one listed product is in it."
                  >
                    Not shown (no products)
                  </span>
                )}
              </td>
              <td>
                <div className="store-category-actions">
                  {row.id ? (
                    <>
                      <button
                        type="button"
                        className="btn secondary btn-sm"
                        disabled={busy}
                        title={
                          row.hidden
                            ? 'Show this category on the shop again'
                            : 'Leave this category off the shop. Its products still show under All and in search.'
                        }
                        onClick={() =>
                          void run(async () => {
                            await patchStoreCategory(practiceId, row.id, { hidden: !row.hidden });
                          })
                        }
                      >
                        {row.hidden ? 'Show' : 'Hide'}
                      </button>
                      <button
                        type="button"
                        className="btn secondary btn-sm store-category-delete"
                        disabled={busy}
                        onClick={() => {
                          if (row.productCount > 0) {
                            setDeleting(row);
                            setMoveTo('');
                            return;
                          }
                          void run(async () => {
                            await deleteStoreCategory(practiceId, row.id);
                          });
                        }}
                      >
                        Delete
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="btn secondary btn-sm"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await createStoreCategory(practiceId, row.name);
                        })
                      }
                    >
                      Keep
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
          {!rows.length ? (
            <tr>
              <td colSpan={5} className="settings-muted">
                No categories yet. Copy from Ecwid or add one.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>

      {deleting ? (
        <div
          className="settings-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-category-title"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !busy) setDeleting(null);
          }}
        >
          <div className="settings-modal">
            <div className="settings-modal-header">
              <h3 id="delete-category-title">Delete {deleting.name}</h3>
              <button
                type="button"
                className="settings-modal-close"
                disabled={busy}
                onClick={() => setDeleting(null)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="settings-modal-body">
              <p style={{ marginTop: 0 }}>
                {deleting.productCount} product{deleting.productCount === 1 ? ' is' : 's are'} in
                this category. Where should {deleting.productCount === 1 ? 'it' : 'they'} go?
              </p>
              <label className="settings-label">
                Move products to
                <select
                  className="settings-input"
                  value={moveTo}
                  disabled={busy}
                  onChange={(e) => setMoveTo(e.target.value)}
                >
                  <option value="">Nowhere. Just take them out of {deleting.name}</option>
                  {rows
                    .filter((row) => row.name !== deleting.name)
                    .map((row) => (
                      <option key={row.name} value={row.name}>
                        {row.name}
                      </option>
                    ))}
                </select>
              </label>
              <p className="settings-muted" style={{ marginBottom: 0 }}>
                Products in other categories too stay in those.
              </p>
              <div className="settings-modal-actions">
                <button
                  type="button"
                  className="btn store-category-delete-confirm"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const result = await deleteStoreCategory(practiceId, deleting.id, moveTo);
                      setDeleting(null);
                      const n = result?.moved ?? 0;
                      setNote(
                        moveTo
                          ? `Deleted ${deleting.name} and moved ${n} product${n === 1 ? '' : 's'} to ${moveTo}.`
                          : `Deleted ${deleting.name} and took ${n} product${n === 1 ? '' : 's'} out of it.`,
                      );
                    })
                  }
                >
                  {moveTo ? 'Move products and delete' : 'Delete category'}
                </button>
                <button
                  type="button"
                  className="btn secondary"
                  disabled={busy}
                  onClick={() => setDeleting(null)}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

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

function practiceIdFromToken(token: string | null): number {
  try {
    if (!token) return Number(import.meta.env.VITE_PRACTICE_ID) || 1;
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
        item so the public shop can browse by group.
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
                {row.id ? (
                  <button
                    type="button"
                    className="brief-text-btn"
                    disabled={busy || row.productCount > 0}
                    title={
                      row.productCount > 0
                        ? 'Move products out of this category first'
                        : undefined
                    }
                    onClick={() =>
                      void run(async () => {
                        await deleteStoreCategory(practiceId, row.id);
                      })
                    }
                  >
                    Delete
                  </button>
                ) : (
                  <button
                    type="button"
                    className="brief-text-btn"
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
              </td>
            </tr>
          ))}
          {!rows.length ? (
            <tr>
              <td colSpan={4} className="settings-muted">
                No categories yet. Copy from Ecwid or add one.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

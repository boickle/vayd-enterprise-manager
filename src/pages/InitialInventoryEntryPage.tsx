import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../auth/useAuth';
import {
  addInventoryLot,
  listInitialInventoryEntry,
  listInventoryBranchLocations,
  listPracticeBranches,
  updateInventoryLot,
  type InitialEntryItem,
  type InventoryBranchLocation,
  type PracticeBranch,
} from '../api/branchInventory';
import { appPrompt } from '../utils/appDialog';
import { resolvePracticeIdFromToken } from '../utils/practiceIdFromToken';
import './Settings.css';

const BRANCH_STORAGE_PREFIX = 'vayd_inventory_branch:';
const LOC_STORAGE_PREFIX = 'vayd_inventory_initial_location:';

type DraftRow = {
  lotNumber: string;
  expirationDate: string;
  quantity: string;
  saving?: boolean;
  error?: string | null;
  savedFlash?: boolean;
};

function useIsInventoryManager(): boolean {
  const { role } = useAuth() as { role?: string | string[] };
  const roles = (Array.isArray(role) ? role : role ? [role] : []).map((r) =>
    String(r).toLowerCase().trim(),
  );
  // Until inventory-manager role ships, admin/superadmin can correct seeded lots.
  return roles.includes('admin') || roles.includes('superadmin');
}

export default function InitialInventoryEntryPage() {
  const { token } = useAuth() as { token: string | null };
  const practiceId = useMemo(() => resolvePracticeIdFromToken(token), [token]);
  const canOverride = useIsInventoryManager();

  const [branches, setBranches] = useState<PracticeBranch[]>([]);
  const [locations, setLocations] = useState<InventoryBranchLocation[]>([]);
  const [branchId, setBranchId] = useState<number | ''>('');
  const [locationId, setLocationId] = useState<number | ''>('');
  const [items, setItems] = useState<InitialEntryItem[]>([]);
  const [draftByItem, setDraftByItem] = useState<Record<number, DraftRow>>({});
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'needs' | 'done'>('all');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    void listPracticeBranches(practiceId)
      .then((list) => {
        const active = list.filter((b) => b.isActive !== false);
        setBranches(active);
        let saved: number | null = null;
        try {
          const raw = localStorage.getItem(`${BRANCH_STORAGE_PREFIX}${practiceId}`);
          const n = raw ? Number(raw) : NaN;
          if (Number.isFinite(n)) saved = n;
        } catch {
          /* ignore */
        }
        const pick =
          active.find((b) => b.id === saved) ||
          active.find((b) => b.isDefault) ||
          active[0];
        if (pick) setBranchId(pick.id);
      })
      .catch(() => setError('Could not load offices'));
  }, [practiceId]);

  useEffect(() => {
    if (branchId === '') {
      setLocations([]);
      setLocationId('');
      return;
    }
    try {
      localStorage.setItem(`${BRANCH_STORAGE_PREFIX}${practiceId}`, String(branchId));
    } catch {
      /* ignore */
    }
    void listInventoryBranchLocations(practiceId, Number(branchId))
      .then((locs) => {
        const active = locs.filter((l) => l.isActive !== false);
        setLocations(active);
        let saved: number | null = null;
        try {
          const raw = localStorage.getItem(
            `${LOC_STORAGE_PREFIX}${practiceId}:${branchId}`,
          );
          const n = raw ? Number(raw) : NaN;
          if (Number.isFinite(n)) saved = n;
        } catch {
          /* ignore */
        }
        const pick =
          active.find((l) => l.id === saved) ||
          active.find((l) => l.isDefault) ||
          active[0];
        setLocationId(pick?.id ?? '');
      })
      .catch(() => {
        setLocations([]);
        setLocationId('');
      });
  }, [practiceId, branchId]);

  const reload = useCallback(async () => {
    if (branchId === '' || locationId === '') {
      setItems([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const rows = await listInitialInventoryEntry(
        practiceId,
        Number(branchId),
        Number(locationId),
      );
      setItems(rows);
      setDraftByItem((prev) => {
        const next = { ...prev };
        for (const row of rows) {
          if (!next[row.inventoryItemId]) {
            next[row.inventoryItemId] = {
              lotNumber: '',
              expirationDate: '',
              quantity: '',
            };
          }
        }
        return next;
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not load inventory');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [practiceId, branchId, locationId]);

  useEffect(() => {
    if (locationId === '') return;
    try {
      localStorage.setItem(
        `${LOC_STORAGE_PREFIX}${practiceId}:${branchId}`,
        String(locationId),
      );
    } catch {
      /* ignore */
    }
    void reload();
  }, [practiceId, branchId, locationId, reload]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((item) => {
      if (filter === 'needs' && item.seededQty > 0) return false;
      if (filter === 'done' && item.seededQty <= 0) return false;
      if (!q) return true;
      return (
        item.name.toLowerCase().includes(q) ||
        (item.code || '').toLowerCase().includes(q) ||
        item.lots.some((lot) => lot.lotNumber.toLowerCase().includes(q))
      );
    });
  }, [items, search, filter]);

  const seededCount = useMemo(
    () => items.filter((item) => item.seededQty > 0).length,
    [items],
  );

  function setDraft(itemId: number, patch: Partial<DraftRow>) {
    setDraftByItem((prev) => ({
      ...prev,
      [itemId]: { ...(prev[itemId] || { lotNumber: '', expirationDate: '', quantity: '' }), ...patch },
    }));
  }

  async function saveNewLot(item: InitialEntryItem) {
    if (branchId === '' || locationId === '') return;
    const draft = draftByItem[item.inventoryItemId] || {
      lotNumber: '',
      expirationDate: '',
      quantity: '',
    };
    const qty = Number(draft.quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      setDraft(item.inventoryItemId, { error: 'Enter a quantity greater than 0' });
      return;
    }
    if (!draft.expirationDate) {
      setDraft(item.inventoryItemId, { error: 'Expiration is required' });
      return;
    }
    if (item.requireLotNumber && !draft.lotNumber.trim()) {
      setDraft(item.inventoryItemId, { error: 'Lot number is required for this item' });
      return;
    }
    setDraft(item.inventoryItemId, { saving: true, error: null });
    try {
      await addInventoryLot(practiceId, {
        inventoryItemId: item.inventoryItemId,
        branchId: Number(branchId),
        branchLocationId: Number(locationId),
        lotNumber: draft.lotNumber.trim(),
        expirationDate: draft.expirationDate,
        quantityOnHand: qty,
        note: 'Initial inventory entry',
      });
      setDraft(item.inventoryItemId, {
        lotNumber: '',
        expirationDate: '',
        quantity: '',
        saving: false,
        error: null,
        savedFlash: true,
      });
      window.setTimeout(() => setDraft(item.inventoryItemId, { savedFlash: false }), 1200);
      await reload();
    } catch (e: unknown) {
      setDraft(item.inventoryItemId, {
        saving: false,
        error: e instanceof Error ? e.message : 'Save failed',
      });
    }
  }

  async function correctLot(item: InitialEntryItem, lotId: number, currentQty: number) {
    if (!canOverride) {
      setToast('Ask an inventory manager or admin to correct a seeded count.');
      window.setTimeout(() => setToast(null), 3500);
      return;
    }
    const qtyRaw = await appPrompt({
      title: 'Correct quantity',
      message: `New on-hand quantity for ${item.name}`,
      defaultValue: String(currentQty),
      confirmLabel: 'Next',
    });
    if (qtyRaw == null) return;
    const target = Number(qtyRaw.trim());
    if (!Number.isFinite(target) || target < 0) {
      setError('Quantity must be 0 or greater');
      return;
    }
    if (target === currentQty) return;
    const reason = await appPrompt({
      title: 'Manager override',
      message: 'Why is this count being corrected? (saved on Activity)',
      placeholder: 'e.g. Miscounted bottle · typo on first entry',
      confirmLabel: 'Save correction',
    });
    if (!reason?.trim()) return;
    setError(null);
    try {
      await updateInventoryLot(practiceId, lotId, {
        quantityOnHand: target,
        note: `Initial entry override: ${reason.trim()}`,
      });
      setToast('Correction saved — see Activity for the audit trail');
      window.setTimeout(() => setToast(null), 3500);
      await reload();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Correction failed');
    }
  }

  const locationName =
    locations.find((l) => l.id === locationId)?.name || 'this location';

  return (
    <div className="settings-card" style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: '0 0 4px' }}>Initial inventory entry</h2>
          <p className="settings-muted" style={{ margin: 0, maxWidth: 52 * 16 }}>
            Seed on-hand lots at one shelf. Rows save as you enter them. Seeded lots lock so they
            cannot be overwritten — managers correct with a tracked reason (Activity).
          </p>
        </div>
        <Link className="btn secondary" to="/schedule/inventory/activity" style={{ alignSelf: 'flex-start' }}>
          Activity
        </Link>
      </div>

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 10,
          marginTop: 14,
          alignItems: 'flex-end',
        }}
      >
        <label className="settings-label" style={{ margin: 0, minWidth: 160 }}>
          Office
          <select
            className="settings-input"
            value={branchId === '' ? '' : String(branchId)}
            onChange={(e) => setBranchId(e.target.value ? Number(e.target.value) : '')}
          >
            <option value="">Choose office</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <label className="settings-label" style={{ margin: 0, minWidth: 180 }}>
          Location
          <select
            className="settings-input"
            value={locationId === '' ? '' : String(locationId)}
            onChange={(e) => setLocationId(e.target.value ? Number(e.target.value) : '')}
            disabled={branchId === ''}
          >
            <option value="">Choose location</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
                {l.isDefault ? ' (default)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="settings-label" style={{ margin: 0, flex: '1 1 200px' }}>
          Search
          <input
            className="settings-input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name, code, or lot #"
          />
        </label>
        <div style={{ display: 'flex', gap: 6 }}>
          {(
            [
              ['all', 'All'],
              ['needs', 'Needs entry'],
              ['done', 'Entered'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`btn secondary${filter === id ? '' : ''}`}
              style={
                filter === id
                  ? { background: '#0f766e', color: '#fff', borderColor: '#0f766e' }
                  : undefined
              }
              onClick={() => setFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {locationId !== '' ? (
        <p className="settings-muted" style={{ margin: '10px 0 0', fontSize: 13 }}>
          Working in <strong>{locationName}</strong> · {seededCount} of {items.length} items have
          stock here
        </p>
      ) : null}

      {toast ? <p className="settings-message" style={{ marginTop: 10 }}>{toast}</p> : null}
      {error ? (
        <div className="settings-message settings-error-message" style={{ marginTop: 10 }}>
          {error}
        </div>
      ) : null}

      {loading ? (
        <p className="settings-muted" style={{ marginTop: 16 }}>
          Loading catalog…
        </p>
      ) : locationId === '' ? (
        <p className="settings-muted" style={{ marginTop: 16 }}>
          Choose an office and location to begin.
        </p>
      ) : (
        <div className="settings-table-container" style={{ marginTop: 14 }}>
          <table className="settings-table">
            <thead>
              <tr>
                <th>Item</th>
                <th style={{ minWidth: 110 }}>Lot #</th>
                <th style={{ minWidth: 130 }}>Expires</th>
                <th style={{ minWidth: 72 }}>Qty</th>
                <th style={{ minWidth: 120 }} />
              </tr>
            </thead>
            <tbody>
              {visible.map((item) => {
                const draft = draftByItem[item.inventoryItemId] || {
                  lotNumber: '',
                  expirationDate: '',
                  quantity: '',
                };
                return (
                  <tr key={item.inventoryItemId}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{item.name}</div>
                      {item.code ? (
                        <div className="settings-muted" style={{ fontSize: 12 }}>
                          {item.code}
                        </div>
                      ) : null}
                      {item.lots.length > 0 ? (
                        <ul style={{ margin: '6px 0 0', paddingLeft: 16, fontSize: 12 }}>
                          {item.lots.map((lot) => (
                            <li key={lot.id} style={{ marginBottom: 2 }}>
                              {lot.lotNumber || 'No lot #'} · exp {lot.expirationDate || '—'} ·{' '}
                              <strong>{lot.quantityOnHand}</strong>
                              {lot.locked ? (
                                <>
                                  {' '}
                                  <span className="settings-muted">locked</span>
                                  {canOverride ? (
                                    <>
                                      {' · '}
                                      <button
                                        type="button"
                                        className="mail-queue__pet-link"
                                        style={{
                                          background: 'none',
                                          border: 0,
                                          padding: 0,
                                          cursor: 'pointer',
                                          font: 'inherit',
                                        }}
                                        onClick={() =>
                                          void correctLot(item, lot.id, lot.quantityOnHand)
                                        }
                                      >
                                        Correct…
                                      </button>
                                    </>
                                  ) : null}
                                </>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <div className="settings-muted" style={{ fontSize: 12, marginTop: 4 }}>
                          Nothing at this location yet
                        </div>
                      )}
                    </td>
                    <td>
                      <input
                        className="settings-input"
                        value={draft.lotNumber}
                        onChange={(e) =>
                          setDraft(item.inventoryItemId, { lotNumber: e.target.value, error: null })
                        }
                        placeholder={item.requireLotNumber ? 'Required' : 'Optional'}
                        aria-label={`${item.name} lot number`}
                      />
                    </td>
                    <td>
                      <input
                        type="date"
                        className="settings-input"
                        value={draft.expirationDate}
                        onChange={(e) =>
                          setDraft(item.inventoryItemId, {
                            expirationDate: e.target.value,
                            error: null,
                          })
                        }
                        aria-label={`${item.name} expiration`}
                      />
                    </td>
                    <td>
                      <input
                        className="settings-input"
                        inputMode="decimal"
                        value={draft.quantity}
                        onChange={(e) =>
                          setDraft(item.inventoryItemId, { quantity: e.target.value, error: null })
                        }
                        onBlur={() => {
                          const d = draftByItem[item.inventoryItemId];
                          if (!d?.quantity.trim() || d.saving) return;
                          if (!d.expirationDate) return;
                          if (item.requireLotNumber && !d.lotNumber.trim()) return;
                          void saveNewLot(item);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            void saveNewLot(item);
                          }
                        }}
                        placeholder="0"
                        aria-label={`${item.name} quantity`}
                      />
                    </td>
                    <td>
                      {draft.saving ? (
                        <span className="settings-muted" style={{ fontSize: 12 }}>
                          Saving…
                        </span>
                      ) : draft.savedFlash ? (
                        <span style={{ fontSize: 12, color: '#166534', fontWeight: 600 }}>Saved</span>
                      ) : draft.error ? (
                        <div className="settings-error-message" style={{ fontSize: 12 }}>
                          {draft.error}
                        </div>
                      ) : (
                        <span className="settings-muted" style={{ fontSize: 11 }}>
                          Tab / Enter saves
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={5} className="settings-muted">
                    No items match.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

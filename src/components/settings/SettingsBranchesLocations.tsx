import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createInventoryBranchLocation,
  createPracticeBranch,
  listInventoryBranchLocations,
  listPracticeBranches,
  patchInventoryBranchLocation,
  patchPracticeBranch,
  type InventoryBranchLocation,
  type PracticeBranch,
} from '../../api/branchInventory';

function extractErr(err: unknown): string {
  const e = err as { response?: { data?: { message?: string | string[] } }; message?: string };
  const msg = e?.response?.data?.message;
  if (Array.isArray(msg)) return msg.join(', ');
  if (typeof msg === 'string' && msg.trim()) return msg;
  return e?.message ?? 'Request failed';
}

type Props = {
  practiceId: number;
  onMessage?: (msg: string, kind: 'success' | 'error') => void;
};

/**
 * Practice offices (branches) and their inventory location buckets (vehicles, rooms, etc.).
 * Location CRUD lived under Inventory Management; it belongs here with branch setup.
 */
export default function SettingsBranchesLocations({ practiceId, onMessage }: Props) {
  const [branches, setBranches] = useState<PracticeBranch[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(true);
  const [selectedBranchId, setSelectedBranchId] = useState<number | null>(null);

  const [locations, setLocations] = useState<InventoryBranchLocation[]>([]);
  const [locLoading, setLocLoading] = useState(false);

  const [newBranchName, setNewBranchName] = useState('');
  const [newBranchPimsId, setNewBranchPimsId] = useState('');
  const [branchSaving, setBranchSaving] = useState(false);

  const [editingBranchId, setEditingBranchId] = useState<number | null>(null);
  const [editBranchName, setEditBranchName] = useState('');
  const [editBranchPimsId, setEditBranchPimsId] = useState('');
  const [editBranchSaving, setEditBranchSaving] = useState(false);

  const [newLocCode, setNewLocCode] = useState('');
  const [newLocName, setNewLocName] = useState('');
  const [newLocSort, setNewLocSort] = useState('');
  const [newLocSaving, setNewLocSaving] = useState(false);

  const [editingLocId, setEditingLocId] = useState<number | null>(null);
  const [editLocName, setEditLocName] = useState('');
  const [editLocSort, setEditLocSort] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  const notify = useCallback(
    (msg: string, kind: 'success' | 'error') => {
      onMessage?.(msg, kind);
    },
    [onMessage]
  );

  const loadBranches = useCallback(async () => {
    setBranchesLoading(true);
    try {
      const list = await listPracticeBranches(practiceId, { includeInactive: true });
      const rows = Array.isArray(list) ? list : [];
      setBranches(rows);
      const selectable = rows.filter((b) => b.isActive !== false);
      setSelectedBranchId((prev) => {
        if (prev != null && selectable.some((b) => b.id === prev)) return prev;
        return selectable.find((b) => b.isDefault)?.id ?? selectable[0]?.id ?? null;
      });
    } catch (e) {
      setBranches([]);
      setSelectedBranchId(null);
      notify(extractErr(e), 'error');
    } finally {
      setBranchesLoading(false);
    }
  }, [practiceId, notify]);

  const loadLocations = useCallback(
    async (branchId: number) => {
      setLocLoading(true);
      try {
        const list = await listInventoryBranchLocations(practiceId, branchId);
        setLocations(Array.isArray(list) ? list : []);
      } catch (e) {
        setLocations([]);
        notify(extractErr(e), 'error');
      } finally {
        setLocLoading(false);
      }
    },
    [practiceId, notify]
  );

  useEffect(() => {
    void loadBranches();
  }, [loadBranches]);

  useEffect(() => {
    if (selectedBranchId == null) {
      setLocations([]);
      return;
    }
    void loadLocations(selectedBranchId);
  }, [selectedBranchId, loadLocations]);

  const activeBranches = useMemo(
    () => branches.filter((b) => b.isActive !== false),
    [branches]
  );
  const selectedBranch = activeBranches.find((b) => b.id === selectedBranchId) ?? null;

  async function addBranch() {
    const name = newBranchName.trim();
    if (!name) {
      notify('Branch name is required', 'error');
      return;
    }
    setBranchSaving(true);
    try {
      const pims = newBranchPimsId.trim();
      const created = await createPracticeBranch(practiceId, {
        name,
        ...(pims ? { pimsLocationId: pims } : {}),
      });
      setNewBranchName('');
      setNewBranchPimsId('');
      notify(`Branch “${created.name}” created`, 'success');
      await loadBranches();
      setSelectedBranchId(created.id);
    } catch (e) {
      notify(extractErr(e), 'error');
    } finally {
      setBranchSaving(false);
    }
  }

  function startEditBranch(b: PracticeBranch) {
    setEditingBranchId(b.id);
    setEditBranchName(b.name);
    setEditBranchPimsId(b.pimsLocationId ?? '');
  }

  async function saveEditBranch() {
    if (editingBranchId == null) return;
    const name = editBranchName.trim();
    if (!name) {
      notify('Branch name is required', 'error');
      return;
    }
    setEditBranchSaving(true);
    try {
      await patchPracticeBranch(practiceId, editingBranchId, {
        name,
        pimsLocationId: editBranchPimsId.trim() || null,
      });
      setEditingBranchId(null);
      notify('Branch updated', 'success');
      await loadBranches();
    } catch (e) {
      notify(extractErr(e), 'error');
    } finally {
      setEditBranchSaving(false);
    }
  }

  async function archiveBranch(b: PracticeBranch) {
    if (b.isDefault) {
      notify('Cannot archive the default branch', 'error');
      return;
    }
    if (!window.confirm(`Archive branch “${b.name}”? It will be hidden from Inventory and day-to-day pickers.`)) {
      return;
    }
    try {
      await patchPracticeBranch(practiceId, b.id, { isActive: false });
      if (selectedBranchId === b.id) setSelectedBranchId(null);
      notify('Branch archived', 'success');
      await loadBranches();
    } catch (e) {
      notify(extractErr(e), 'error');
    }
  }

  async function restoreBranch(b: PracticeBranch) {
    try {
      await patchPracticeBranch(practiceId, b.id, { isActive: true });
      notify('Branch restored', 'success');
      await loadBranches();
      setSelectedBranchId(b.id);
    } catch (e) {
      notify(extractErr(e), 'error');
    }
  }

  async function addLocation() {
    if (selectedBranchId == null) return;
    const code = newLocCode.trim();
    const name = newLocName.trim();
    if (!code || !name) {
      notify('Location code and name are required', 'error');
      return;
    }
    setNewLocSaving(true);
    try {
      const sortOrderRaw = newLocSort.trim();
      const sortOrder = sortOrderRaw === '' ? undefined : Number(sortOrderRaw);
      await createInventoryBranchLocation(practiceId, selectedBranchId, {
        code,
        name,
        ...(Number.isFinite(sortOrder as number) ? { sortOrder: sortOrder as number } : {}),
      });
      setNewLocCode('');
      setNewLocName('');
      setNewLocSort('');
      notify('Location created', 'success');
      await loadLocations(selectedBranchId);
    } catch (e) {
      notify(extractErr(e), 'error');
    } finally {
      setNewLocSaving(false);
    }
  }

  async function deactivateLocation(loc: InventoryBranchLocation) {
    if (selectedBranchId == null || loc.isDefault) return;
    if (!window.confirm(`Deactivate location “${loc.name}”?`)) return;
    try {
      await patchInventoryBranchLocation(practiceId, selectedBranchId, loc.id, {
        isActive: false,
      });
      notify('Location deactivated', 'success');
      await loadLocations(selectedBranchId);
    } catch (e) {
      notify(extractErr(e), 'error');
    }
  }

  function startEditLocation(loc: InventoryBranchLocation) {
    setEditingLocId(loc.id);
    setEditLocName(loc.name);
    setEditLocSort(loc.sortOrder != null ? String(loc.sortOrder) : '');
  }

  async function saveEditLocation() {
    if (selectedBranchId == null || editingLocId == null) return;
    const name = editLocName.trim();
    if (!name) {
      notify('Location name is required', 'error');
      return;
    }
    setEditSaving(true);
    try {
      const sortOrderRaw = editLocSort.trim();
      const sortOrder = sortOrderRaw === '' ? undefined : Number(sortOrderRaw);
      await patchInventoryBranchLocation(practiceId, selectedBranchId, editingLocId, {
        name,
        ...(Number.isFinite(sortOrder as number) ? { sortOrder: sortOrder as number } : {}),
      });
      setEditingLocId(null);
      notify('Location updated', 'success');
      await loadLocations(selectedBranchId);
    } catch (e) {
      notify(extractErr(e), 'error');
    } finally {
      setEditSaving(false);
    }
  }

  return (
    <div className="settings-branches-locations">
      <div className="settings-card" style={{ marginBottom: 24 }}>
        <h3 className="settings-card-title">Branches (offices)</h3>
        <p className="settings-muted" style={{ marginBottom: 12 }}>
          A branch is a practice site or office. Inventory, tasks, and stock movements are scoped to
          a branch. Creating a branch also creates a default <code>main</code> location bucket.
        </p>

        {branchesLoading ? (
          <p className="settings-muted">Loading branches…</p>
        ) : (
          <>
            <div className="settings-table-container" style={{ marginBottom: 16 }}>
              <table className="settings-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Default</th>
                    <th>Status</th>
                    <th>PIMS location id</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {branches.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="settings-muted">
                        No branches yet.
                      </td>
                    </tr>
                  ) : (
                    branches.map((b) => {
                      const archived = b.isActive === false;
                      const editing = editingBranchId === b.id;
                      return (
                        <tr key={b.id} style={archived ? { opacity: 0.72 } : undefined}>
                          <td>
                            {editing ? (
                              <input
                                className="settings-input"
                                value={editBranchName}
                                onChange={(e) => setEditBranchName(e.target.value)}
                                style={{ maxWidth: 260 }}
                              />
                            ) : (
                              <strong>{b.name}</strong>
                            )}
                          </td>
                          <td>{b.isDefault ? 'Yes' : '—'}</td>
                          <td>{archived ? 'Archived' : 'Active'}</td>
                          <td>
                            {editing ? (
                              <input
                                className="settings-input"
                                value={editBranchPimsId}
                                onChange={(e) => setEditBranchPimsId(e.target.value)}
                                placeholder="Optional"
                                style={{ maxWidth: 160 }}
                              />
                            ) : b.pimsLocationId ? (
                              <code>{b.pimsLocationId}</code>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                              {editing ? (
                                <>
                                  <button
                                    type="button"
                                    className="btn primary"
                                    style={{ fontSize: 12, padding: '4px 10px' }}
                                    disabled={editBranchSaving}
                                    onClick={() => void saveEditBranch()}
                                  >
                                    {editBranchSaving ? 'Saving…' : 'Save'}
                                  </button>
                                  <button
                                    type="button"
                                    className="btn secondary"
                                    style={{ fontSize: 12, padding: '4px 10px' }}
                                    disabled={editBranchSaving}
                                    onClick={() => setEditingBranchId(null)}
                                  >
                                    Cancel
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    className="btn secondary"
                                    style={{ fontSize: 12, padding: '4px 10px' }}
                                    onClick={() => startEditBranch(b)}
                                  >
                                    Edit
                                  </button>
                                  {archived ? (
                                    <button
                                      type="button"
                                      className="btn secondary"
                                      style={{ fontSize: 12, padding: '4px 10px' }}
                                      onClick={() => void restoreBranch(b)}
                                    >
                                      Restore
                                    </button>
                                  ) : (
                                    !b.isDefault && (
                                      <button
                                        type="button"
                                        className="btn secondary"
                                        style={{ fontSize: 12, padding: '4px 10px' }}
                                        onClick={() => void archiveBranch(b)}
                                      >
                                        Archive
                                      </button>
                                    )
                                  )}
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 10,
                alignItems: 'flex-end',
                maxWidth: 720,
              }}
            >
              <label className="settings-label" style={{ flex: '1 1 200px', marginBottom: 0 }}>
                New branch name
                <input
                  className="settings-input"
                  value={newBranchName}
                  onChange={(e) => setNewBranchName(e.target.value)}
                  placeholder="e.g. Brunswick office"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void addBranch();
                    }
                  }}
                />
              </label>
              <label className="settings-label" style={{ flex: '1 1 160px', marginBottom: 0 }}>
                PIMS location id (optional)
                <input
                  className="settings-input"
                  value={newBranchPimsId}
                  onChange={(e) => setNewBranchPimsId(e.target.value)}
                  placeholder="eVet / PIMS id"
                />
              </label>
              <button
                type="button"
                className="btn primary"
                disabled={branchSaving}
                onClick={() => void addBranch()}
              >
                {branchSaving ? 'Adding…' : 'Add branch'}
              </button>
            </div>
          </>
        )}
      </div>

      <div className="settings-card" style={{ marginBottom: 8 }}>
        <h3 className="settings-card-title">Location buckets</h3>
        <p className="settings-muted" style={{ marginBottom: 12 }}>
          Each branch has a default <code>main</code> bucket. Add more (office, vehicle, staging,
          etc.) for transfers and reporting. Stock moves between these buckets under Inventory.
        </p>

        <label className="settings-label" htmlFor="settings-loc-branch" style={{ maxWidth: 420 }}>
          Branch
          <select
            id="settings-loc-branch"
            className="settings-input"
            style={{ marginTop: 4 }}
            value={selectedBranchId ?? ''}
            disabled={!activeBranches.length}
            onChange={(e) => {
              const v = Number(e.target.value);
              setSelectedBranchId(Number.isFinite(v) ? v : null);
              setEditingLocId(null);
            }}
          >
            {!activeBranches.length && <option value="">No active branches</option>}
            {activeBranches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
                {b.isDefault ? ' (default)' : ''}
              </option>
            ))}
          </select>
        </label>

        {selectedBranchId == null ? (
          <p className="settings-muted" style={{ marginTop: 12 }}>
            Create an active branch above, then pick it here to manage locations.
          </p>
        ) : locLoading ? (
          <p className="settings-muted" style={{ marginTop: 12 }}>
            Loading locations…
          </p>
        ) : (
          <>
            {selectedBranch && (
              <p className="settings-muted" style={{ marginTop: 12, marginBottom: 0 }}>
                Buckets for <strong>{selectedBranch.name}</strong>
              </p>
            )}
            <div className="settings-table-container" style={{ marginBottom: 16 }}>
              <table className="settings-table">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Name</th>
                    <th>Sort</th>
                    <th>Default</th>
                    <th>Active</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {locations.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="settings-muted">
                        No active locations for this branch.
                      </td>
                    </tr>
                  ) : (
                    locations.map((loc) => (
                      <tr key={loc.id}>
                        <td>
                          <code>{loc.code}</code>
                        </td>
                        <td>
                          {editingLocId === loc.id ? (
                            <input
                              className="settings-input"
                              value={editLocName}
                              onChange={(e) => setEditLocName(e.target.value)}
                              style={{ maxWidth: 220 }}
                            />
                          ) : (
                            loc.name
                          )}
                        </td>
                        <td>
                          {editingLocId === loc.id ? (
                            <input
                              className="settings-input"
                              value={editLocSort}
                              onChange={(e) => setEditLocSort(e.target.value)}
                              style={{ maxWidth: 80 }}
                              placeholder="0"
                            />
                          ) : (
                            loc.sortOrder ?? '—'
                          )}
                        </td>
                        <td>{loc.isDefault ? 'Yes' : '—'}</td>
                        <td>{loc.isActive === false ? 'No' : 'Yes'}</td>
                        <td>
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {editingLocId === loc.id ? (
                              <>
                                <button
                                  type="button"
                                  className="btn primary"
                                  style={{ fontSize: 12, padding: '4px 10px' }}
                                  disabled={editSaving}
                                  onClick={() => void saveEditLocation()}
                                >
                                  {editSaving ? 'Saving…' : 'Save'}
                                </button>
                                <button
                                  type="button"
                                  className="btn secondary"
                                  style={{ fontSize: 12, padding: '4px 10px' }}
                                  disabled={editSaving}
                                  onClick={() => setEditingLocId(null)}
                                >
                                  Cancel
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  className="btn secondary"
                                  style={{ fontSize: 12, padding: '4px 10px' }}
                                  onClick={() => startEditLocation(loc)}
                                >
                                  Edit
                                </button>
                                {!loc.isDefault && loc.isActive !== false && (
                                  <button
                                    type="button"
                                    className="btn secondary"
                                    style={{ fontSize: 12, padding: '4px 10px' }}
                                    onClick={() => void deactivateLocation(loc)}
                                  >
                                    Deactivate
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 10,
                alignItems: 'flex-end',
                maxWidth: 720,
              }}
            >
              <label className="settings-label" style={{ flex: '1 1 140px', marginBottom: 0 }}>
                New code
                <input
                  className="settings-input"
                  value={newLocCode}
                  onChange={(e) => setNewLocCode(e.target.value)}
                  placeholder="e.g. vehicle_1"
                />
              </label>
              <label className="settings-label" style={{ flex: '1 1 160px', marginBottom: 0 }}>
                New name
                <input
                  className="settings-input"
                  value={newLocName}
                  onChange={(e) => setNewLocName(e.target.value)}
                  placeholder="Display name"
                />
              </label>
              <label className="settings-label" style={{ flex: '0 1 100px', marginBottom: 0 }}>
                Sort
                <input
                  className="settings-input"
                  value={newLocSort}
                  onChange={(e) => setNewLocSort(e.target.value)}
                  placeholder="Optional"
                />
              </label>
              <button
                type="button"
                className="btn primary"
                disabled={newLocSaving}
                onClick={() => void addLocation()}
              >
                {newLocSaving ? 'Adding…' : 'Add location'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

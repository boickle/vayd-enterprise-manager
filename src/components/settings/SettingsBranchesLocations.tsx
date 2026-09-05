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
  type PracticeBranchAddressBody,
} from '../../api/branchInventory';
import { formatAddressFields } from '../../api/geo';
import { AddressAutocomplete, type AddressFields } from '../AddressAutocomplete';
import { EMPTY_ADDRESS_FIELDS } from '../../utils/verifiedAddress';
import { appConfirm } from '../../utils/appDialog';

function branchToAddress(b: PracticeBranch): AddressFields {
  return {
    line1: b.address1 ?? '',
    line2: b.address2 ?? '',
    city: b.city ?? '',
    state: b.state ?? '',
    zip: b.zipcode ?? '',
    country: b.country ?? 'US',
    ...(b.latitude != null ? { lat: Number(b.latitude) } : {}),
    ...(b.longitude != null ? { lon: Number(b.longitude) } : {}),
  };
}

function formatBranchAddress(b: PracticeBranch): string {
  return formatAddressFields({
    line1: b.address1 ?? '',
    line2: b.address2 ?? undefined,
    city: b.city ?? '',
    state: b.state ?? '',
    zip: b.zipcode ?? '',
  }).trim();
}

function addressPayload(a: AddressFields): PracticeBranchAddressBody {
  return {
    address1: a.line1.trim(),
    address2: a.line2?.trim() || null,
    city: a.city.trim(),
    state: a.state.trim(),
    zipcode: a.zip.trim(),
    country: a.country?.trim() || 'US',
    latitude: a.lat ?? null,
    longitude: a.lon ?? null,
  };
}

function isAddressComplete(a: AddressFields): boolean {
  return Boolean(a.line1.trim() && a.city.trim() && a.state.trim() && a.zip.trim());
}

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

  const [branchFormName, setBranchFormName] = useState('');
  const [branchFormPimsId, setBranchFormPimsId] = useState('');
  const [branchFormAddress, setBranchFormAddress] = useState<AddressFields>({
    ...EMPTY_ADDRESS_FIELDS,
  });
  const [branchSaving, setBranchSaving] = useState(false);
  const [editingBranchId, setEditingBranchId] = useState<number | null>(null);

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

  function resetBranchForm() {
    setEditingBranchId(null);
    setBranchFormName('');
    setBranchFormPimsId('');
    setBranchFormAddress({ ...EMPTY_ADDRESS_FIELDS });
  }

  async function saveBranch() {
    const name = branchFormName.trim();
    if (!name) {
      notify('Branch name is required', 'error');
      return;
    }
    if (!isAddressComplete(branchFormAddress)) {
      notify('Street, city, state, and ZIP are required', 'error');
      return;
    }
    setBranchSaving(true);
    try {
      const pims = branchFormPimsId.trim();
      const address = addressPayload(branchFormAddress);
      if (editingBranchId != null) {
        await patchPracticeBranch(practiceId, editingBranchId, {
          name,
          pimsLocationId: pims || null,
          ...address,
        });
        notify('Branch updated', 'success');
      } else {
        const created = await createPracticeBranch(practiceId, {
          name,
          ...(pims ? { pimsLocationId: pims } : {}),
          ...address,
        });
        setSelectedBranchId(created.id);
        notify(`Branch “${created.name}” created`, 'success');
      }
      resetBranchForm();
      await loadBranches();
    } catch (e) {
      notify(extractErr(e), 'error');
    } finally {
      setBranchSaving(false);
    }
  }

  function startEditBranch(b: PracticeBranch) {
    setEditingBranchId(b.id);
    setBranchFormName(b.name);
    setBranchFormPimsId(b.pimsLocationId ?? '');
    setBranchFormAddress(branchToAddress(b));
  }

  async function archiveBranch(b: PracticeBranch) {
    if (b.isDefault) {
      notify('Cannot archive the default branch', 'error');
      return;
    }
    const ok = await appConfirm({
      title: 'Archive branch?',
      message: `Archive branch “${b.name}”? It will be hidden from Inventory and day-to-day pickers.`,
      confirmLabel: 'Archive',
      danger: true,
    });
    if (!ok) return;
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
    const ok = await appConfirm({
      title: 'Deactivate location?',
      message: `Deactivate location “${loc.name}”?`,
      confirmLabel: 'Deactivate',
      danger: true,
    });
    if (!ok) return;
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
          a branch. Each branch needs a street address. Creating a branch also creates a default{' '}
          <code>main</code> location bucket.
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
                    <th>Address</th>
                    <th>Default</th>
                    <th>Status</th>
                    <th>PIMS location id</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {branches.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="settings-muted">
                        No branches yet.
                      </td>
                    </tr>
                  ) : (
                    branches.map((b) => {
                      const archived = b.isActive === false;
                      const editing = editingBranchId === b.id;
                      const addressText = formatBranchAddress(b);
                      return (
                        <tr
                          key={b.id}
                          style={{
                            opacity: archived ? 0.72 : undefined,
                            background: editing ? '#f0fdf4' : undefined,
                          }}
                        >
                          <td>
                            <strong>{b.name}</strong>
                          </td>
                          <td>
                            {addressText ? (
                              addressText
                            ) : (
                              <span className="settings-muted">Add address</span>
                            )}
                          </td>
                          <td>{b.isDefault ? 'Yes' : '—'}</td>
                          <td>{archived ? 'Archived' : 'Active'}</td>
                          <td>
                            {b.pimsLocationId ? <code>{b.pimsLocationId}</code> : '—'}
                          </td>
                          <td>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
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
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <div className="settings-branch-form">
              <h4 className="settings-branch-form-title">
                {editingBranchId != null ? 'Edit branch' : 'Add branch'}
              </h4>
              <div className="settings-branch-form-row">
                <label className="settings-label" style={{ marginBottom: 0 }}>
                  Branch name
                  <input
                    className="settings-input"
                    value={branchFormName}
                    onChange={(e) => setBranchFormName(e.target.value)}
                    placeholder="e.g. Brunswick office"
                  />
                </label>
                <label className="settings-label" style={{ marginBottom: 0 }}>
                  PIMS location id (optional)
                  <input
                    className="settings-input"
                    value={branchFormPimsId}
                    onChange={(e) => setBranchFormPimsId(e.target.value)}
                    placeholder="eVet / PIMS id"
                  />
                </label>
              </div>
              <label className="settings-label settings-branch-address-street">
                Address
                <AddressAutocomplete
                  value={branchFormAddress}
                  onChange={setBranchFormAddress}
                  placeholder="Start typing the office address"
                  inputClassName="settings-input"
                  compact
                  showConfirmedMessage
                />
              </label>
              <div className="settings-branch-address-grid">
                <label className="settings-label" style={{ marginBottom: 0 }}>
                  City
                  <input
                    className="settings-input"
                    value={branchFormAddress.city}
                    onChange={(e) =>
                      setBranchFormAddress((prev) => ({
                        ...prev,
                        city: e.target.value,
                        lat: undefined,
                        lon: undefined,
                      }))
                    }
                    placeholder="City"
                  />
                </label>
                <label className="settings-label" style={{ marginBottom: 0 }}>
                  State
                  <input
                    className="settings-input"
                    value={branchFormAddress.state}
                    onChange={(e) =>
                      setBranchFormAddress((prev) => ({
                        ...prev,
                        state: e.target.value,
                        lat: undefined,
                        lon: undefined,
                      }))
                    }
                    placeholder="ME"
                  />
                </label>
                <label className="settings-label" style={{ marginBottom: 0 }}>
                  ZIP
                  <input
                    className="settings-input"
                    value={branchFormAddress.zip}
                    onChange={(e) =>
                      setBranchFormAddress((prev) => ({
                        ...prev,
                        zip: e.target.value,
                        lat: undefined,
                        lon: undefined,
                      }))
                    }
                    placeholder="04011"
                  />
                </label>
              </div>
              <div className="settings-branch-form-actions">
                <button
                  type="button"
                  className="btn primary"
                  disabled={branchSaving}
                  onClick={() => void saveBranch()}
                >
                  {branchSaving
                    ? 'Saving…'
                    : editingBranchId != null
                      ? 'Save branch'
                      : 'Add branch'}
                </button>
                {editingBranchId != null ? (
                  <button
                    type="button"
                    className="btn secondary"
                    disabled={branchSaving}
                    onClick={resetBranchForm}
                  >
                    Cancel
                  </button>
                ) : null}
              </div>
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

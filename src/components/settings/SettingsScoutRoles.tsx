import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createScoutEmployeeRole,
  fetchAllEmployees,
  fetchEmployeeRoles,
  fetchScoutRoleAssignments,
  fetchRoleManualBookingAppointmentTypes,
  patchScoutEmployeeRole,
  replaceScoutRoleAssignments,
  updateRoleManualBookingAppointmentTypes,
  type AppointmentType,
  type Employee,
  type EmployeeRole,
  type ScoutRoleAssignment,
} from '../../api/appointmentSettings';
import {
  listPracticeBranches,
  type PracticeBranch,
} from '../../api/branchInventory';
import { appointmentTypeIsArchived } from '../../utils/appointmentTypeSettings';

function extractErr(err: unknown): string {
  const e = err as { response?: { data?: { message?: string } }; message?: string };
  const msg = e?.response?.data?.message ?? e?.message ?? 'Request failed';
  return Array.isArray(msg) ? msg.join(', ') : String(msg);
}

function formatEmployeeName(emp: Employee): string {
  const parts = [emp.title, emp.firstName, emp.lastName, emp.designation].filter(Boolean);
  return parts.length
    ? parts.join(' ')
    : `${emp.firstName || ''} ${emp.lastName || ''}`.trim() || `Employee ${emp.id}`;
}

type Props = {
  practiceId: number;
  appointmentTypes: AppointmentType[];
  allAppointmentTypes?: AppointmentType[];
  onMessage?: (msg: string, kind: 'success' | 'error') => void;
};

export default function SettingsScoutRoles({
  practiceId,
  appointmentTypes,
  allAppointmentTypes,
  onMessage,
}: Props) {
  const [roles, setRoles] = useState<EmployeeRole[]>([]);
  const [rolesLoading, setRolesLoading] = useState(true);
  const [selectedRoleId, setSelectedRoleId] = useState<number | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [branches, setBranches] = useState<PracticeBranch[]>([]);
  const [assignments, setAssignments] = useState<ScoutRoleAssignment[]>([]);
  const [assignLoading, setAssignLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editSlug, setEditSlug] = useState('');
  const [editBranchSpecific, setEditBranchSpecific] = useState(false);

  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newBranchSpecific, setNewBranchSpecific] = useState(false);

  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<number[]>([]);
  const [selectedByBranch, setSelectedByBranch] = useState<Record<number, number[]>>({});

  const [manualOpen, setManualOpen] = useState(false);
  const [manualTypeIds, setManualTypeIds] = useState<number[]>([]);
  const [manualLoading, setManualLoading] = useState(false);
  const [manualSaving, setManualSaving] = useState(false);
  const selectAllRef = useRef<HTMLInputElement>(null);

  const selectedRole = useMemo(
    () => roles.find((r) => r.id === selectedRoleId) ?? null,
    [roles, selectedRoleId]
  );

  const activeEmployees = useMemo(
    () =>
      employees
        .filter((e) => e.isActive !== false && e.isDeleted !== true)
        .slice()
        .sort((a, b) => formatEmployeeName(a).localeCompare(formatEmployeeName(b))),
    [employees]
  );

  const activeBranches = useMemo(
    () => branches.filter((b) => b.isActive !== false).slice().sort((a, b) => a.name.localeCompare(b.name)),
    [branches]
  );

  const activeTypes = useMemo(
    () => appointmentTypes.filter((t) => t.isActive !== false && !appointmentTypeIsArchived(t)),
    [appointmentTypes]
  );
  const activeTypeIds = useMemo(() => activeTypes.map((t) => t.id), [activeTypes]);
  const allActiveSelected =
    activeTypeIds.length > 0 && activeTypeIds.every((id) => manualTypeIds.includes(id));
  const someActiveSelected = activeTypeIds.some((id) => manualTypeIds.includes(id));

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someActiveSelected && !allActiveSelected;
    }
  }, [someActiveSelected, allActiveSelected]);

  const loadRoles = useCallback(async () => {
    setRolesLoading(true);
    try {
      const list = await fetchEmployeeRoles({ owner: 'scout' });
      setRoles(Array.isArray(list) ? list : []);
    } catch (e) {
      onMessage?.(extractErr(e), 'error');
      setRoles([]);
    } finally {
      setRolesLoading(false);
    }
  }, [onMessage]);

  useEffect(() => {
    void loadRoles();
    void fetchAllEmployees()
      .then((list) => setEmployees(Array.isArray(list) ? list : []))
      .catch(() => setEmployees([]));
    void listPracticeBranches(practiceId)
      .then((list) => setBranches(Array.isArray(list) ? list : []))
      .catch(() => setBranches([]));
  }, [loadRoles, practiceId]);

  useEffect(() => {
    if (roles.length === 0) {
      setSelectedRoleId(null);
      return;
    }
    setSelectedRoleId((cur) =>
      cur != null && roles.some((r) => r.id === cur) ? cur : roles[0].id
    );
  }, [roles]);

  useEffect(() => {
    if (!selectedRole) {
      setEditName('');
      setEditDescription('');
      setEditSlug('');
      setEditBranchSpecific(false);
      setAssignments([]);
      setSelectedEmployeeIds([]);
      setSelectedByBranch({});
      setManualTypeIds([]);
      return;
    }
    setEditName(selectedRole.name);
    setEditDescription(selectedRole.description ?? '');
    setEditSlug(selectedRole.slug ?? '');
    setEditBranchSpecific(Boolean(selectedRole.isBranchSpecific));
  }, [selectedRole]);

  const loadAssignments = useCallback(
    async (roleId: number) => {
      setAssignLoading(true);
      try {
        const res = await fetchScoutRoleAssignments(roleId, practiceId);
        setAssignments(res.assignments);
        if (res.role.isBranchSpecific) {
          const byBranch: Record<number, number[]> = {};
          for (const a of res.assignments) {
            if (a.branchId == null) continue;
            byBranch[a.branchId] = [...(byBranch[a.branchId] ?? []), a.employeeId];
          }
          setSelectedByBranch(byBranch);
          setSelectedEmployeeIds([]);
        } else {
          setSelectedEmployeeIds(res.assignments.map((a) => a.employeeId));
          setSelectedByBranch({});
        }
      } catch (e) {
        onMessage?.(extractErr(e), 'error');
        setAssignments([]);
      } finally {
        setAssignLoading(false);
      }
    },
    [onMessage, practiceId]
  );

  useEffect(() => {
    if (selectedRoleId == null) return;
    void loadAssignments(selectedRoleId);
  }, [selectedRoleId, loadAssignments]);

  const loadManual = useCallback(
    async (roleId: number) => {
      setManualLoading(true);
      try {
        const rows = await fetchRoleManualBookingAppointmentTypes(roleId);
        setManualTypeIds(
          rows
            .map((r) => Number(r.appointmentTypeId))
            .filter((id) => Number.isFinite(id) && id > 0)
            .sort((a, b) => a - b)
        );
      } catch (e) {
        setManualTypeIds([]);
        onMessage?.(extractErr(e), 'error');
      } finally {
        setManualLoading(false);
      }
    },
    [onMessage]
  );

  useEffect(() => {
    if (!manualOpen || selectedRoleId == null) return;
    void loadManual(selectedRoleId);
  }, [manualOpen, selectedRoleId, loadManual]);

  async function handleSaveRoleDetails(e: FormEvent) {
    e.preventDefault();
    if (selectedRoleId == null) return;
    setSaving(true);
    try {
      const updated = await patchScoutEmployeeRole(selectedRoleId, {
        name: editName.trim(),
        description: editDescription.trim() || null,
        slug: editSlug.trim() || null,
        isBranchSpecific: editBranchSpecific,
      });
      setRoles((prev) => prev.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)));
      onMessage?.(`Saved ${updated.name}.`, 'success');
      await loadAssignments(updated.id);
    } catch (err) {
      onMessage?.(extractErr(err), 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleAddRole(e: FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) {
      onMessage?.('Role name is required.', 'error');
      return;
    }
    setSaving(true);
    try {
      const created = await createScoutEmployeeRole({
        name,
        isBranchSpecific: newBranchSpecific,
      });
      setRoles((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      setSelectedRoleId(created.id);
      setAdding(false);
      setNewName('');
      setNewBranchSpecific(false);
      onMessage?.(`Added ${created.name}.`, 'success');
    } catch (err) {
      onMessage?.(extractErr(err), 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveAssignments() {
    if (selectedRoleId == null || !selectedRole) return;
    setSaving(true);
    try {
      const payload = selectedRole.isBranchSpecific
        ? Object.entries(selectedByBranch).flatMap(([branchId, employeeIds]) =>
            employeeIds.map((employeeId) => ({
              employeeId,
              branchId: Number(branchId),
            }))
          )
        : selectedEmployeeIds.map((employeeId) => ({
            employeeId,
            branchId: null as number | null,
          }));
      const res = await replaceScoutRoleAssignments(selectedRoleId, practiceId, payload);
      setAssignments(res.assignments);
      onMessage?.(`Assignees saved for ${selectedRole.name}.`, 'success');
    } catch (err) {
      onMessage?.(extractErr(err), 'error');
    } finally {
      setSaving(false);
    }
  }

  function toggleEmployee(id: number, checked: boolean) {
    setSelectedEmployeeIds((cur) =>
      checked ? [...new Set([...cur, id])] : cur.filter((x) => x !== id)
    );
  }

  function toggleBranchEmployee(branchId: number, employeeId: number, checked: boolean) {
    setSelectedByBranch((cur) => {
      const list = cur[branchId] ?? [];
      const next = checked
        ? [...new Set([...list, employeeId])]
        : list.filter((x) => x !== employeeId);
      return { ...cur, [branchId]: next };
    });
  }

  async function handleSaveManual() {
    if (selectedRoleId == null || !selectedRole) return;
    setManualSaving(true);
    try {
      await updateRoleManualBookingAppointmentTypes(selectedRoleId, manualTypeIds);
      onMessage?.(`Manual booking types saved for ${selectedRole.name}.`, 'success');
    } catch (e) {
      onMessage?.(extractErr(e), 'error');
    } finally {
      setManualSaving(false);
    }
  }

  const archivedSelectedTypes = useMemo(() => {
    const catalog = allAppointmentTypes ?? appointmentTypes;
    const activeIds = new Set(activeTypes.map((t) => t.id));
    return catalog.filter(
      (t) => appointmentTypeIsArchived(t) && manualTypeIds.includes(t.id) && !activeIds.has(t.id)
    );
  }, [allAppointmentTypes, appointmentTypes, activeTypes, manualTypeIds]);

  return (
    <div className="settings-section">
      <p className="settings-section-description">
        Scout-owned roles used for permissions and future automated tasks. People can hold
        multiple roles. Branch-specific roles (for example Inventory Manager) are assigned per
        office; others are practice-wide.
      </p>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(200px, 260px) 1fr',
          gap: 20,
          alignItems: 'start',
        }}
      >
        <div className="settings-card" style={{ margin: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <h3 className="settings-card-title" style={{ margin: 0 }}>
              Roles
            </h3>
            <button
              type="button"
              className="btn secondary"
              style={{ padding: '4px 10px', fontSize: 13 }}
              onClick={() => setAdding((v) => !v)}
            >
              {adding ? 'Cancel' : 'Add'}
            </button>
          </div>
          {adding && (
            <form onSubmit={(e) => void handleAddRole(e)} style={{ marginBottom: 12 }}>
              <input
                className="settings-input"
                placeholder="New role name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                style={{ marginBottom: 8 }}
              />
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={newBranchSpecific}
                  onChange={(e) => setNewBranchSpecific(e.target.checked)}
                />
                Is branch-specific
              </label>
              <button type="submit" className="btn primary" disabled={saving}>
                Create
              </button>
            </form>
          )}
          {rolesLoading ? (
            <p className="settings-muted">Loading…</p>
          ) : roles.length === 0 ? (
            <p className="settings-muted">No Scout roles yet.</p>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {roles.map((role) => (
                <li key={role.id} style={{ marginBottom: 4 }}>
                  <button
                    type="button"
                    onClick={() => setSelectedRoleId(role.id)}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      padding: '8px 10px',
                      borderRadius: 8,
                      border:
                        role.id === selectedRoleId
                          ? '1px solid var(--color-primary, #2f6f5e)'
                          : '1px solid transparent',
                      background: role.id === selectedRoleId ? 'rgba(47,111,94,0.08)' : 'transparent',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ fontWeight: 600 }}>{role.name}</div>
                    <div className="settings-muted" style={{ fontSize: 12 }}>
                      {role.isBranchSpecific ? 'Per office' : 'Practice-wide'}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          {!selectedRole ? (
            <p className="settings-muted">Select a role.</p>
          ) : (
            <>
              <form className="settings-card" style={{ marginTop: 0 }} onSubmit={(e) => void handleSaveRoleDetails(e)}>
                <h3 className="settings-card-title">{selectedRole.name}</h3>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 12,
                    marginBottom: 12,
                  }}
                >
                  <label className="settings-label">
                    Name
                    <input
                      className="settings-input"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      required
                    />
                  </label>
                  <label className="settings-label">
                    Slug
                    <input
                      className="settings-input"
                      value={editSlug}
                      onChange={(e) => setEditSlug(e.target.value)}
                      placeholder="auto from name"
                    />
                  </label>
                </div>
                <label className="settings-label" style={{ display: 'block', marginBottom: 12 }}>
                  Description
                  <textarea
                    className="settings-input"
                    rows={2}
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                  />
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <input
                    type="checkbox"
                    checked={editBranchSpecific}
                    onChange={(e) => setEditBranchSpecific(e.target.checked)}
                  />
                  <span>Is branch-specific</span>
                </label>
                <p className="settings-muted" style={{ fontSize: 12, marginTop: 0 }}>
                  Changing this clears assignees that no longer match (practice-wide vs per office).
                </p>
                <button type="submit" className="btn primary" disabled={saving}>
                  {saving ? 'Saving…' : 'Save role'}
                </button>
              </form>

              <div className="settings-card">
                <h3 className="settings-card-title">
                  {selectedRole.isBranchSpecific
                    ? `Who is ${selectedRole.name}?`
                    : `Who has ${selectedRole.name}?`}
                </h3>
                {assignLoading ? (
                  <p className="settings-muted">Loading assignees…</p>
                ) : selectedRole.isBranchSpecific ? (
                  <div style={{ display: 'grid', gap: 16 }}>
                    {activeBranches.map((branch) => (
                      <div key={branch.id}>
                        <div style={{ fontWeight: 600, marginBottom: 6 }}>{branch.name}</div>
                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                            gap: 4,
                            maxHeight: 180,
                            overflow: 'auto',
                          }}
                        >
                          {activeEmployees.map((emp) => (
                            <label
                              key={`${branch.id}-${emp.id}`}
                              style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}
                            >
                              <input
                                type="checkbox"
                                checked={(selectedByBranch[branch.id] ?? []).includes(emp.id)}
                                onChange={(e) =>
                                  toggleBranchEmployee(branch.id, emp.id, e.target.checked)
                                }
                              />
                              <span>{formatEmployeeName(emp)}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    ))}
                    {activeBranches.length === 0 && (
                      <p className="settings-muted">No active offices.</p>
                    )}
                  </div>
                ) : (
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                      gap: 4,
                      maxHeight: 280,
                      overflow: 'auto',
                    }}
                  >
                    {activeEmployees.map((emp) => (
                      <label
                        key={emp.id}
                        style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}
                      >
                        <input
                          type="checkbox"
                          checked={selectedEmployeeIds.includes(emp.id)}
                          onChange={(e) => toggleEmployee(emp.id, e.target.checked)}
                        />
                        <span>{formatEmployeeName(emp)}</span>
                      </label>
                    ))}
                  </div>
                )}
                <div style={{ marginTop: 12 }}>
                  <button
                    type="button"
                    className="btn primary"
                    disabled={saving || assignLoading}
                    onClick={() => void handleSaveAssignments()}
                  >
                    {saving ? 'Saving…' : 'Save assignees'}
                  </button>
                  {assignments.length > 0 && (
                    <span className="settings-muted" style={{ marginLeft: 12, fontSize: 13 }}>
                      {assignments.length} saved
                    </span>
                  )}
                </div>
              </div>

              <div className="settings-card">
                <button
                  type="button"
                  className="btn secondary"
                  style={{ marginBottom: manualOpen ? 12 : 0 }}
                  onClick={() => setManualOpen((v) => !v)}
                >
                  {manualOpen ? 'Hide manual booking' : 'Manual booking permissions'}
                </button>
                {manualOpen && (
                  <>
                    <p className="settings-muted" style={{ fontSize: 13, marginTop: 0 }}>
                      Appointment types staff with this role may book manually on the calendar
                      (routing is not restricted).
                    </p>
                    {manualLoading ? (
                      <p className="settings-muted">Loading…</p>
                    ) : (
                      <div
                        className="settings-checkbox-list"
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                          gap: 4,
                          maxHeight: 240,
                          overflow: 'auto',
                        }}
                      >
                        {activeTypes.length > 0 ? (
                          <label className="settings-checkbox-item settings-checkbox-item--select-all">
                            <input
                              ref={selectAllRef}
                              type="checkbox"
                              checked={allActiveSelected}
                              onChange={() => {
                                setManualTypeIds((cur) => {
                                  const activeIdSet = new Set(activeTypeIds);
                                  const preserved = cur.filter((id) => !activeIdSet.has(id));
                                  if (allActiveSelected) return preserved.sort((a, b) => a - b);
                                  return Array.from(new Set([...preserved, ...activeTypeIds])).sort(
                                    (a, b) => a - b
                                  );
                                });
                              }}
                            />
                            <span>Select all</span>
                          </label>
                        ) : null}
                        {activeTypes.map((type) => (
                          <label key={type.id} className="settings-checkbox-item">
                            <input
                              type="checkbox"
                              checked={manualTypeIds.includes(type.id)}
                              onChange={() =>
                                setManualTypeIds((cur) =>
                                  cur.includes(type.id)
                                    ? cur.filter((id) => id !== type.id)
                                    : [...cur, type.id].sort((a, b) => a - b)
                                )
                              }
                            />
                            <span>{type.prettyName || type.name}</span>
                          </label>
                        ))}
                        {archivedSelectedTypes.map((type) => (
                          <label
                            key={type.id}
                            className="settings-checkbox-item settings-checkbox-item--disabled"
                          >
                            <input type="checkbox" checked disabled readOnly />
                            <span>
                              {type.prettyName || type.name}
                              <span className="settings-appt-type-archived-badge">Archived</span>
                            </span>
                          </label>
                        ))}
                      </div>
                    )}
                    <button
                      type="button"
                      className="btn primary"
                      style={{ marginTop: 12 }}
                      disabled={manualSaving || manualLoading}
                      onClick={() => void handleSaveManual()}
                    >
                      {manualSaving ? 'Saving…' : 'Save manual booking'}
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

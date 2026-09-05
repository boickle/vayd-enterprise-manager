import { FormEvent, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  fetchAllEmployees,
  fetchEmployee,
  fetchEmployeeRoles,
  updateEmployeeBio,
  updateEmployeeRoles,
  EMPLOYEE_BIO_MAX_LENGTH,
  type Employee,
  type EmployeeRole,
} from '../../api/appointmentSettings';
import {
  deleteEmployees,
  saveEmployees,
  upsertEmployees,
  type EmployeeDto,
} from '../../api/employeesMutations';
import {
  getEmployeeBranches,
  listInventoryBranchLocations,
  listPracticeBranches,
  setEmployeeBranches,
  type InventoryBranchLocation,
  type PracticeBranch,
} from '../../api/branchInventory';
import { appConfirm } from '../../utils/appDialog';
import { fetchAdminUsers, type AdminManagedUser } from '../../api/users';
import { scoutManagedState } from '../../utils/pimsScoutManaged';
import {
  assignEmployeeRoleNameGroup,
  groupEmployeeRolesByName,
  isEmployeeRoleNameGroupSelected,
} from '../../utils/employeeRoleDisplay';

const DEFAULT_PRACTICE_ID = Number(import.meta.env.VITE_PRACTICE_ID) || 1;

function extractErr(err: unknown): string {
  const e = err as { response?: { data?: { message?: string } }; message?: string };
  return e?.response?.data?.message ?? e?.message ?? 'Request failed';
}

function empPimsUserId(e: Employee): string {
  const raw = (e as Record<string, unknown>).pimsUserId;
  if (raw == null) return '—';
  return String(raw);
}

function empPimsId(e: Employee): string {
  const raw = (e as Record<string, unknown>).pimsId;
  if (raw == null) return '—';
  return String(raw);
}

function empActive(e: Employee): boolean {
  const r = e as Record<string, unknown>;
  if (r.isActive === false || r.isDeleted === true) return false;
  return true;
}

function str(v: unknown): string {
  if (v == null) return '';
  return String(v);
}

/** Empty string → null for API nullable string fields */
function blankToNull(s: string): string | null {
  const t = s.trim();
  return t === '' ? null : t;
}

type ModalMode = 'add' | 'edit' | 'roles' | 'bio' | null;

function employeeRoleIds(e: Employee, allowedIds?: Set<number>): number[] {
  const r = e as Record<string, unknown>;
  let ids: number[] = [];
  if (Array.isArray(r.roleIds)) {
    ids = r.roleIds
      .map((x) => Number(x))
      .filter((n) => Number.isFinite(n) && n > 0);
  } else {
    const assignments = r.roleAssignments;
    if (Array.isArray(assignments)) {
      ids = assignments
        .map((row) => {
          if (!row || typeof row !== 'object') return NaN;
          const a = row as { roleId?: unknown; branchId?: unknown };
          // Practice-wide only for Staff checkboxes
          if (a.branchId != null && a.branchId !== '') return NaN;
          return Number(a.roleId);
        })
        .filter((n) => Number.isFinite(n) && n > 0);
    }
  }
  if (allowedIds) ids = ids.filter((id) => allowedIds.has(id));
  return [...new Set(ids)];
}

function employeeDisplayName(emp: Employee): string {
  const r = emp as Record<string, unknown>;
  const mid = str(r.middleName);
  const parts = [emp.title, emp.firstName, mid, emp.lastName].filter(Boolean);
  return parts.length ? parts.join(' ') : `${emp.firstName} ${emp.lastName}`.trim();
}

function empBio(e: Employee): string | null | undefined {
  return e.bio ?? (e as Record<string, unknown>).bio as string | null | undefined;
}

function empPhone1(e: Employee): string {
  const raw = e.phone1 ?? (e as Record<string, unknown>).phone1;
  const s = str(raw).trim();
  return s || '—';
}

function empPhone2(e: Employee): string | null {
  const raw = e.phone2 ?? (e as Record<string, unknown>).phone2;
  const s = str(raw).trim();
  return s || null;
}

export type EmployeeHubSection =
  | 'profile'
  | 'schedule'
  | 'types'
  | 'zones'
  | 'goals'
  | 'photo';

const HUB_SECTIONS: { id: EmployeeHubSection; label: string }[] = [
  { id: 'profile', label: 'Profile' },
  { id: 'schedule', label: 'Schedule' },
  { id: 'types', label: 'Appointment types' },
  { id: 'goals', label: 'Goals' },
  { id: 'photo', label: 'Photo' },
];

type Props = {
  onMessage?: (msg: string, kind: 'success' | 'error') => void;
  section?: EmployeeHubSection;
  onSectionChange?: (section: EmployeeHubSection) => void;
  selectedEmployeeId?: number | null;
  onSelectedEmployeeIdChange?: (id: number | null) => void;
  extra?: ReactNode;
};

export default function SettingsEmployeeDirectory({
  onMessage,
  section = 'profile',
  onSectionChange,
  selectedEmployeeId,
  onSelectedEmployeeIdChange,
  extra,
}: Props) {
  const [rows, setRows] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [modalMode, setModalMode] = useState<ModalMode>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [title, setTitle] = useState('');
  const [designation, setDesignation] = useState('');
  const [pimsId, setPimsId] = useState('');
  const [pimsUserId, setPimsUserId] = useState('');
  const [pimsType, setPimsType] = useState('EVET');
  const [isProvider, setIsProvider] = useState(false);
  const [middleName, setMiddleName] = useState('');
  const [licenseNumber, setLicenseNumber] = useState('');
  const [address1, setAddress1] = useState('');
  const [address2, setAddress2] = useState('');
  const [address3, setAddress3] = useState('');
  const [city, setCity] = useState('');
  const [stateAbbr, setStateAbbr] = useState('');
  const [zipcode, setZipcode] = useState('');
  const [county, setCounty] = useState('');
  const [country, setCountry] = useState('');
  const [phone1, setPhone1] = useState('');
  const [phone2, setPhone2] = useState('');
  const [roleIdsSelected, setRoleIdsSelected] = useState<number[]>([]);
  const [rolesCatalog, setRolesCatalog] = useState<EmployeeRole[]>([]);
  const [rolesEditEmployee, setRolesEditEmployee] = useState<Employee | null>(null);
  const [bioEditEmployee, setBioEditEmployee] = useState<Employee | null>(null);
  const [bioText, setBioText] = useState('');
  const [branchOptions, setBranchOptions] = useState<PracticeBranch[]>([]);
  const [locationOptions, setLocationOptions] = useState<InventoryBranchLocation[]>([]);
  const [defaultBranchId, setDefaultBranchId] = useState<number | null>(null);
  const [defaultLocationId, setDefaultLocationId] = useState<number | null>(null);
  const [loginUser, setLoginUser] = useState<AdminManagedUser | null>(null);
  const [loadedEmployee, setLoadedEmployee] = useState<Employee | null>(null);

  const practice = useMemo(() => ({ id: DEFAULT_PRACTICE_ID }), []);

  const practiceWideRoleIds = useMemo(
    () => new Set(rolesCatalog.filter((r) => !r.isBranchSpecific).map((r) => r.id)),
    [rolesCatalog]
  );

  const roleGroups = useMemo(() => {
    const practiceWide = rolesCatalog.filter((r) => !r.isBranchSpecific);
    return groupEmployeeRolesByName(practiceWide);
  }, [rolesCatalog]);

  useEffect(() => {
    let cancelled = false;
    void fetchEmployeeRoles({ owner: 'scout' })
      .then((list) => {
        if (!cancelled) setRolesCatalog(Array.isArray(list) ? list : []);
      })
      .catch(() => {
        if (!cancelled) setRolesCatalog([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const list = await fetchAllEmployees();
      setRows(Array.isArray(list) ? list : []);
    } catch (e) {
      setLoadError(extractErr(e));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openAdd = () => {
    setEditingId(null);
    setFirstName('');
    setLastName('');
    setMiddleName('');
    setEmail('');
    setTitle('');
    setDesignation('');
    setLicenseNumber('');
    setPimsId('');
    setPimsUserId('');
    setPimsType('VAYD');
    setIsProvider(false);
    setLoginUser(null);
    setLoadedEmployee(null);
    setAddress1('');
    setAddress2('');
    setAddress3('');
    setCity('');
    setStateAbbr('');
    setZipcode('');
    setCounty('');
    setCountry('');
    setPhone1('');
    setPhone2('');
    setRoleIdsSelected([]);
    setDefaultBranchId(null);
    setDefaultLocationId(null);
    setLocationOptions([]);
    void listPracticeBranches(DEFAULT_PRACTICE_ID)
      .then((list) => setBranchOptions(list.filter((b) => b.isActive !== false)))
      .catch(() => setBranchOptions([]));
    setModalMode('add');
  };

  const applyRecordToForm = (full: Employee) => {
    const r = full as Record<string, unknown>;
    setFirstName(str(full.firstName));
    setLastName(str(full.lastName));
    setMiddleName(str(r.middleName));
    setEmail(str(full.email));
    setTitle(str(full.title));
    setDesignation(str(full.designation));
    setLicenseNumber(str(r.licenseNumber));
    setPimsId(str(r.pimsId));
    setPimsUserId(str(r.pimsUserId));
    setPimsType(str(r.pimsType) || 'EVET');
    setIsProvider(full.isProvider === true);
    setAddress1(str(r.address1));
    setAddress2(str(r.address2));
    setAddress3(str(r.address3));
    setCity(str(r.city));
    setStateAbbr(str(r.state));
    setZipcode(str(r.zipcode));
    setCounty(str(r.county));
    setCountry(str(r.country));
    setPhone1(str(r.phone1));
    setPhone2(str(r.phone2));
    setRoleIdsSelected(employeeRoleIds(full, practiceWideRoleIds));
  };

  const openEditBio = async (id: number) => {
    setSaving(false);
    setModalMode(null);
    try {
      const full = await fetchEmployee(id);
      setEditingId(id);
      setBioEditEmployee(full);
      setBioText(full.bio ?? '');
      setModalMode('bio');
    } catch (e) {
      onMessage?.(extractErr(e), 'error');
    }
  };

  const openEditRoles = async (id: number) => {
    setSaving(false);
    setModalMode(null);
    try {
      const full = await fetchEmployee(id);
      setEditingId(id);
      setRolesEditEmployee(full);
      setRoleIdsSelected(employeeRoleIds(full, practiceWideRoleIds));
      setModalMode('roles');
    } catch (e) {
      onMessage?.(extractErr(e), 'error');
    }
  };

  const openEdit = async (id: number) => {
    setSaving(false);
    setModalMode((cur) => (cur === 'add' ? 'add' : null));
    try {
      const [full, branchList, empBranches] = await Promise.all([
        fetchEmployee(id),
        listPracticeBranches(DEFAULT_PRACTICE_ID),
        getEmployeeBranches(DEFAULT_PRACTICE_ID, id).catch(() => []),
      ]);
      setEditingId(id);
      setLoadedEmployee(full);
      applyRecordToForm(full);
      setBioText(full.bio ?? '');
      setBranchOptions(branchList.filter((b) => b.isActive !== false));
      const primary = empBranches.find((b) => b.isPrimary) ?? empBranches[0] ?? null;
      const seedBranch =
        primary?.branchId ??
        branchList.find((b) => b.isDefault)?.id ??
        branchList[0]?.id ??
        null;
      setDefaultBranchId(seedBranch);
      setDefaultLocationId(primary?.defaultInventoryLocationId ?? null);
      const linked = await fetchAdminUsers({ employeeId: id }).catch(() => []);
      setLoginUser(linked.find((u) => u.employeeId === id) ?? linked[0] ?? null);
      if (seedBranch != null) {
        try {
          const locs = await listInventoryBranchLocations(DEFAULT_PRACTICE_ID, seedBranch);
          setLocationOptions(locs.filter((l) => l.isActive !== false));
        } catch {
          setLocationOptions([]);
        }
      } else {
        setLocationOptions([]);
      }
    } catch (e) {
      onMessage?.(extractErr(e), 'error');
    }
  };

  useEffect(() => {
    if (selectedEmployeeId != null && selectedEmployeeId !== editingId) {
      void openEdit(selectedEmployeeId);
    }
    // Load the URL/parent selection once it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEmployeeId]);

  useEffect(() => {
    if (editingId == null && modalMode !== 'add') return;
    if (defaultBranchId == null) {
      setLocationOptions([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const locs = await listInventoryBranchLocations(DEFAULT_PRACTICE_ID, defaultBranchId);
        if (cancelled) return;
        const active = locs.filter((l) => l.isActive !== false);
        setLocationOptions(active);
        setDefaultLocationId((prev) => {
          if (prev != null && active.some((l) => l.id === prev)) return prev;
          return active.find((l) => l.isDefault)?.id ?? active[0]?.id ?? null;
        });
      } catch {
        if (!cancelled) setLocationOptions([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [modalMode, editingId, defaultBranchId]);

  const toggleRoleGroup = (nameKey: string, checked: boolean) => {
    const group = roleGroups.find((g) => g.nameKey === nameKey);
    if (!group) return;
    setRoleIdsSelected((cur) => assignEmployeeRoleNameGroup(group, cur, checked));
  };

  const closeModal = () => {
    if (!saving) {
      setModalMode(null);
      setRolesEditEmployee(null);
      setBioEditEmployee(null);
    }
  };

  const submitBioModal = async (e: FormEvent) => {
    e.preventDefault();
    if (editingId == null) return;
    const trimmed = bioText.trim();
    if (trimmed.length > EMPLOYEE_BIO_MAX_LENGTH) {
      onMessage?.(`Bio must be ${EMPLOYEE_BIO_MAX_LENGTH} characters or fewer.`, 'error');
      return;
    }
    setSaving(true);
    try {
      await updateEmployeeBio(editingId, trimmed === '' ? null : trimmed);
      onMessage?.('Employee bio updated.', 'success');
      setModalMode(null);
      setBioEditEmployee(null);
      await load();
    } catch (err) {
      onMessage?.(extractErr(err), 'error');
    } finally {
      setSaving(false);
    }
  };

  const submitRolesModal = async (e: FormEvent) => {
    e.preventDefault();
    if (editingId == null) return;
    setSaving(true);
    try {
      await updateEmployeeRoles(editingId, {
        roleIds: roleIdsSelected.length ? [...roleIdsSelected] : [],
      });
      onMessage?.('Employee roles updated.', 'success');
      setModalMode(null);
      setRolesEditEmployee(null);
      await load();
    } catch (err) {
      onMessage?.(extractErr(err), 'error');
    } finally {
      setSaving(false);
    }
  };

  const buildPayloadFromForm = (): Record<string, unknown> => {
    const fn = firstName.trim();
    const ln = lastName.trim();
    const payload: Record<string, unknown> = {
      firstName: fn,
      lastName: ln,
      middleName: blankToNull(middleName),
      email: blankToNull(email),
      title: blankToNull(title),
      designation: blankToNull(designation),
      licenseNumber: blankToNull(licenseNumber),
      pimsId: blankToNull(pimsId),
      pimsUserId: blankToNull(pimsUserId),
      pimsType: blankToNull(pimsType) ?? 'VAYD',
      isProvider,
      address1: blankToNull(address1),
      address2: blankToNull(address2),
      address3: blankToNull(address3),
      city: blankToNull(city),
      state: blankToNull(stateAbbr),
      zipcode: blankToNull(zipcode),
      county: blankToNull(county),
      country: blankToNull(country),
      phone1: blankToNull(phone1),
      phone2: blankToNull(phone2),
      practice,
      isActive: true,
      isDeleted: false,
    };
    return payload;
  };

  const saveOfficeAndRoles = async (id: number) => {
    await updateEmployeeRoles(id, {
      roleIds: roleIdsSelected.length ? [...roleIdsSelected] : [],
    });
    const trimmedBio = bioText.trim();
    if (trimmedBio.length > EMPLOYEE_BIO_MAX_LENGTH) {
      throw new Error(`Bio must be ${EMPLOYEE_BIO_MAX_LENGTH} characters or fewer.`);
    }
    await updateEmployeeBio(id, trimmedBio === '' ? null : trimmedBio);
    if (defaultBranchId != null) {
      const existing = await getEmployeeBranches(DEFAULT_PRACTICE_ID, id).catch(() => []);
      const branchIds =
        existing.length > 0
          ? [...new Set([...existing.map((b) => b.branchId), defaultBranchId])]
          : [defaultBranchId];
      await setEmployeeBranches(DEFAULT_PRACTICE_ID, id, {
        branchIds,
        primaryBranchId: defaultBranchId,
        defaultInventoryLocationId: defaultLocationId,
      });
    }
  };

  const submitModal = async (e: FormEvent) => {
    e.preventDefault();
    if (modalMode === 'add') {
      const fn = firstName.trim();
      const ln = lastName.trim();
      if (!fn || !ln) {
        onMessage?.('First name and last name are required.', 'error');
        return;
      }
      setSaving(true);
      try {
        const basePayload = buildPayloadFromForm();
        const dto = { ...basePayload } as EmployeeDto;
        if (pimsId.trim()) {
          await upsertEmployees(dto);
          onMessage?.('Employee added.', 'success');
        } else {
          await saveEmployees(dto);
          onMessage?.('Employee added.', 'success');
        }
        setModalMode(null);
        await load();
      } catch (err) {
        onMessage?.(extractErr(err), 'error');
      } finally {
        setSaving(false);
      }
      return;
    }

    if (editingId == null) return;
    const fn = firstName.trim();
    const ln = lastName.trim();
    if (!fn || !ln) {
      onMessage?.('First name and last name are required.', 'error');
      return;
    }
    setSaving(true);
    try {
      const full = await fetchEmployee(editingId);
      const prev = full as unknown as Record<string, unknown>;
      const form = buildPayloadFromForm();
      if (loginUser) {
        form.email = loginUser.email ?? prev.email ?? null;
      }
      const merged: EmployeeDto = {
        ...prev,
        ...form,
        id: editingId,
        practice:
          (full.practice as object | undefined) ??
          (prev.practice as object | undefined) ??
          practice,
        isActive: prev.isActive !== false,
        isDeleted: prev.isDeleted === true,
      } as EmployeeDto;
      await saveEmployees(merged);
      await saveOfficeAndRoles(editingId);
      const refreshed = await fetchEmployee(editingId);
      setLoadedEmployee(refreshed);
      onMessage?.('Employee updated.', 'success');
      await load();
    } catch (err) {
      onMessage?.(extractErr(err), 'error');
    } finally {
      setSaving(false);
    }
  };

  const deactivate = async (emp: Employee) => {
    const ok = await appConfirm({
      title: 'Deactivate employee?',
      message: `Deactivate ${emp.firstName} ${emp.lastName}? They will be hidden from active lists.`,
      confirmLabel: 'Deactivate',
      danger: true,
    });
    if (!ok) return;
    try {
      const full = await fetchEmployee(emp.id);
      const merged = {
        ...(full as unknown as Record<string, unknown>),
        id: emp.id,
        isActive: false,
        isDeleted: false,
      } as EmployeeDto;
      await saveEmployees(merged);
      onMessage?.('Employee deactivated.', 'success');
      await load();
    } catch (err) {
      onMessage?.(extractErr(err), 'error');
    }
  };

  const reactivate = async (emp: Employee) => {
    try {
      const full = await fetchEmployee(emp.id);
      const merged = {
        ...(full as unknown as Record<string, unknown>),
        id: emp.id,
        isActive: true,
        isDeleted: false,
      } as EmployeeDto;
      await saveEmployees(merged);
      onMessage?.('Employee reactivated.', 'success');
      await load();
    } catch (err) {
      onMessage?.(extractErr(err), 'error');
    }
  };

  const removeRow = async (emp: Employee) => {
    const ok = await appConfirm({
      title: 'Delete employee?',
      message: `Permanently delete employee #${emp.id} from the database? This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteEmployees([emp.id]);
      onMessage?.('Employee deleted.', 'success');
      await load();
    } catch (err) {
      onMessage?.(extractErr(err), 'error');
    }
  };

  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      const aProvider = a.isProvider === true ? 0 : 1;
      const bProvider = b.isProvider === true ? 0 : 1;
      if (aProvider !== bProvider) return aProvider - bProvider;
      return `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`);
    });
  }, [rows]);

  const selectEmployee = (id: number) => {
    onSelectedEmployeeIdChange?.(id);
    void openEdit(id);
  };

  const ownership = scoutManagedState(
    loadedEmployee as unknown as Record<string, unknown> | null,
    'employee'
  );
  const emailLocked = loginUser != null;

  return (
    <div className="settings-employee-directory">
      <p className="settings-section-description" style={{ marginTop: 0 }}>
        Choose a person, then use the tabs for profile, schedule (hours, offices, and zones),
        appointment types, goals, and photo.
      </p>

      <div className="settings-employee-hub">
        <div className="settings-employee-hub__toolbar">
          <label className="settings-employee-hub__staff-field">
            <span className="settings-label">Staff</span>
            <select
              className="settings-select"
              value={editingId ?? ''}
              aria-label="Staff"
              onChange={(e) => {
                const empId = Number(e.target.value);
                if (empId) selectEmployee(empId);
              }}
            >
              <option value="">{loading ? 'Loading…' : 'Select staff…'}</option>
              {sorted.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {employeeDisplayName(emp)}
                  {emp.isProvider ? ' · Provider' : ''}
                  {empActive(emp) ? '' : ' · Inactive'}
                </option>
              ))}
            </select>
          </label>
          <div className="settings-employee-hub__toolbar-actions">
            <button type="button" className="btn" onClick={openAdd}>
              Add
            </button>
            <button type="button" className="btn secondary" onClick={() => void load()}>
              Refresh
            </button>
          </div>
        </div>
        {loadError && <div className="settings-error-message">{loadError}</div>}

        {editingId == null ? (
          <div className="settings-card">
            <p className="settings-muted" style={{ margin: 0 }}>
              Select an employee to manage their profile, default office, and schedule.
            </p>
          </div>
        ) : (
          <>
              <div className="settings-employee-hub__sections" role="tablist" aria-label="Employee sections">
                {HUB_SECTIONS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    aria-selected={section === item.id}
                    className={`settings-employee-hub__section${section === item.id ? ' is-active' : ''}`}
                    onClick={() => onSectionChange?.(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              {section === 'profile' ? (
                <form onSubmit={submitModal} className="settings-employee-hub__form">
                  <fieldset className="settings-employee-modal__fieldset">
                    <legend className="settings-employee-modal__legend">Default office</legend>
                    <p className="muted" style={{ fontSize: 12, margin: '0 0 8px' }}>
                      Checkout takes inventory from this office unless someone changes it on the
                      invoice.
                    </p>
                    <div className="settings-employee-modal__grid">
                      <label>
                        <span className="label">Default branch</span>
                        <select
                          className="input"
                          value={defaultBranchId ?? ''}
                          onChange={(e) => {
                            const v = e.target.value === '' ? null : Number(e.target.value);
                            setDefaultBranchId(v != null && Number.isFinite(v) ? v : null);
                            setDefaultLocationId(null);
                          }}
                        >
                          <option value="">Select branch…</option>
                          {branchOptions.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span className="label">Default location</span>
                        <select
                          className="input"
                          value={defaultLocationId ?? ''}
                          disabled={defaultBranchId == null}
                          onChange={(e) => {
                            const v = e.target.value === '' ? null : Number(e.target.value);
                            setDefaultLocationId(v != null && Number.isFinite(v) ? v : null);
                          }}
                        >
                          <option value="">Select location…</option>
                          {locationOptions.map((loc) => (
                            <option key={loc.id} value={loc.id}>
                              {loc.name}
                              {loc.isDefault ? ' (default)' : ''}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  </fieldset>

                  <fieldset className="settings-employee-modal__fieldset">
                    <legend className="settings-employee-modal__legend">Name</legend>
                    <p className="muted" style={{ fontSize: 12, margin: '0 0 8px' }} title={ownership.title}>
                      {ownership.label}. A save here makes Scout the source of truth.
                    </p>
                    <div className="settings-employee-modal__grid">
                      <label>
                        <span className="label">First name</span>
                        <input
                          className="input"
                          value={firstName}
                          onChange={(e) => setFirstName(e.target.value)}
                        />
                      </label>
                      <label>
                        <span className="label">Last name</span>
                        <input
                          className="input"
                          value={lastName}
                          onChange={(e) => setLastName(e.target.value)}
                        />
                      </label>
                      <label>
                        <span className="label">Title</span>
                        <input
                          className="input"
                          value={title}
                          onChange={(e) => setTitle(e.target.value)}
                        />
                      </label>
                      <label>
                        <span className="label">Email</span>
                        <input
                          className="input"
                          type="email"
                          value={emailLocked ? (loginUser.email ?? email) : email}
                          onChange={(e) => setEmail(e.target.value)}
                          disabled={emailLocked}
                        />
                        {emailLocked ? (
                          <p className="muted" style={{ fontSize: 12, margin: '6px 0 0' }}>
                            This is their login email.{' '}
                            <a href={`/admin/users?user=${loginUser.id}`}>Edit it on Users</a>
                            . It must be unique among all users.
                          </p>
                        ) : (
                          <p className="muted" style={{ fontSize: 12, margin: '6px 0 0' }}>
                            Contact email. After they have a login, change it on Users.
                          </p>
                        )}
                      </label>
                      <label>
                        <span className="label">Phone</span>
                        <input
                          className="input"
                          type="tel"
                          value={phone1}
                          onChange={(e) => setPhone1(e.target.value)}
                        />
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, alignSelf: 'end' }}>
                        <input
                          type="checkbox"
                          checked={isProvider}
                          onChange={(e) => setIsProvider(e.target.checked)}
                        />
                        <span>Scheduling provider</span>
                      </label>
                    </div>
                  </fieldset>

                  <fieldset className="settings-employee-modal__fieldset">
                    <legend className="settings-employee-modal__legend">Roles</legend>
                    <p className="muted" style={{ fontSize: 12, margin: '0 0 8px' }}>
                      Practice-wide Scout roles only. Branch-specific roles are on{' '}
                      <a href="/schedule/settings?tab=roles">Staff → Roles</a>.
                    </p>
                    {roleGroups.length === 0 ? (
                      <p className="muted" style={{ fontSize: 13, margin: 0 }}>
                        No practice-wide Scout roles loaded.
                      </p>
                    ) : (
                      <div className="settings-employee-modal__roles" role="group" aria-label="Employee roles">
                        {roleGroups.map((group) => (
                          <label
                            key={group.nameKey}
                            style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, cursor: 'pointer' }}
                          >
                            <input
                              type="checkbox"
                              checked={isEmployeeRoleNameGroupSelected(group, roleIdsSelected)}
                              onChange={(e) => toggleRoleGroup(group.nameKey, e.target.checked)}
                            />
                            <span>{group.displayName}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </fieldset>

                  <fieldset className="settings-employee-modal__fieldset">
                    <legend className="settings-employee-modal__legend">Bio</legend>
                    <textarea
                      className="input"
                      rows={4}
                      value={bioText}
                      onChange={(e) => setBioText(e.target.value)}
                      maxLength={EMPLOYEE_BIO_MAX_LENGTH}
                    />
                    <p className="muted" style={{ fontSize: 12, margin: '6px 0 0' }}>
                      {bioText.length}/{EMPLOYEE_BIO_MAX_LENGTH}
                    </p>
                  </fieldset>

                  <div className="settings-employee-hub__form-actions">
                    <button type="submit" className="btn" disabled={saving}>
                      {saving ? 'Saving…' : 'Save profile'}
                    </button>
                    {editingId != null ? (
                      <>
                        {rows.find((r) => r.id === editingId) && empActive(rows.find((r) => r.id === editingId)!) ? (
                          <button
                            type="button"
                            className="btn secondary"
                            onClick={() => void deactivate(rows.find((r) => r.id === editingId)!)}
                          >
                            Deactivate
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="btn secondary"
                            onClick={() => {
                              const emp = rows.find((r) => r.id === editingId);
                              if (emp) void reactivate(emp);
                            }}
                          >
                            Reactivate
                          </button>
                        )}
                      </>
                    ) : null}
                  </div>
                </form>
              ) : (
                extra
              )}
            </>
          )}
      </div>

      {modalMode === 'roles' && rolesEditEmployee ? (
        <div className="settings-employee-modal-root" role="presentation">
          <button type="button" className="settings-employee-modal-backdrop" aria-label="Close" onClick={closeModal} />
          <div className="settings-employee-modal" role="dialog" aria-modal="true" aria-labelledby="employee-roles-title">
            <div className="settings-employee-modal__head">
              <h3 id="employee-roles-title">Employee roles</h3>
              <button type="button" className="settings-close" onClick={closeModal} aria-label="Close">
                ×
              </button>
            </div>
            <form onSubmit={submitRolesModal} className="settings-employee-modal__form">
              <p className="muted" style={{ margin: '0 0 12px' }}>
                <strong>{employeeDisplayName(rolesEditEmployee)}</strong>
                <span className="muted"> · ID {rolesEditEmployee.id}</span>
              </p>
              <p className="muted" style={{ margin: '0 0 16px', fontSize: 13 }}>
                Practice-wide Scout roles for this person. Branch-specific roles (for example Inventory
                Manager) are assigned under <strong>Staff → Roles</strong>. Manual booking types are also
                configured there.
              </p>
              <fieldset className="settings-employee-modal__fieldset">
                <legend className="settings-employee-modal__legend">Assigned roles</legend>
                {roleGroups.length === 0 ? (
                  <p className="muted" style={{ fontSize: 13, margin: 0 }}>
                    No practice-wide Scout roles loaded. Add them under Staff → Roles.
                  </p>
                ) : (
                  <div className="settings-employee-modal__roles" role="group" aria-label="Employee roles">
                    {roleGroups.map((group) => (
                      <label
                        key={group.nameKey}
                        style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, cursor: 'pointer' }}
                      >
                        <input
                          type="checkbox"
                          checked={isEmployeeRoleNameGroupSelected(group, roleIdsSelected)}
                          onChange={(e) => toggleRoleGroup(group.nameKey, e.target.checked)}
                        />
                        <span>{group.displayName}</span>
                      </label>
                    ))}
                  </div>
                )}
              </fieldset>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
                <button type="button" className="btn secondary" onClick={closeModal} disabled={saving}>
                  Cancel
                </button>
                <button type="submit" className="btn" disabled={saving}>
                  {saving ? 'Saving…' : 'Save roles'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {modalMode === 'bio' && bioEditEmployee ? (
        <div className="settings-employee-modal-root" role="presentation">
          <button type="button" className="settings-employee-modal-backdrop" aria-label="Close" onClick={closeModal} />
          <div className="settings-employee-modal" role="dialog" aria-modal="true" aria-labelledby="employee-bio-title">
            <div className="settings-employee-modal__head">
              <h3 id="employee-bio-title">Employee bio</h3>
              <button type="button" className="settings-close" onClick={closeModal} aria-label="Close">
                ×
              </button>
            </div>
            <form onSubmit={submitBioModal} className="settings-employee-modal__form">
              <p className="muted" style={{ margin: '0 0 12px' }}>
                <strong>{employeeDisplayName(bioEditEmployee)}</strong>
                <span className="muted"> · ID {bioEditEmployee.id}</span>
              </p>
              <p className="muted" style={{ margin: '0 0 12px', fontSize: 13 }}>
                Profile copy for VAYD (not synced from PIMS). Plain text only.
              </p>
              <label className="settings-employee-modal__full">
                <span className="label">Bio</span>
                <textarea
                  className="input"
                  value={bioText}
                  onChange={(e) => setBioText(e.target.value)}
                  rows={8}
                  maxLength={EMPLOYEE_BIO_MAX_LENGTH}
                  placeholder="Short profile for booking, team pages, etc."
                  style={{ resize: 'vertical', width: '100%', boxSizing: 'border-box' }}
                />
                <span
                  className="muted"
                  style={{ display: 'block', marginTop: 6, fontSize: 12, textAlign: 'right' }}
                >
                  {bioText.length} / {EMPLOYEE_BIO_MAX_LENGTH}
                </span>
              </label>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
                <button type="button" className="btn secondary" onClick={closeModal} disabled={saving}>
                  Cancel
                </button>
                <button type="submit" className="btn" disabled={saving}>
                  {saving ? 'Saving…' : 'Save bio'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {modalMode === 'add' ? (
        <div className="settings-employee-modal-root" role="presentation">
          <button type="button" className="settings-employee-modal-backdrop" aria-label="Close" onClick={closeModal} />
          <div className="settings-employee-modal settings-employee-modal--wide" role="dialog" aria-modal="true">
            <div className="settings-employee-modal__head">
              <h3>{modalMode === 'add' ? 'Add employee' : 'Edit employee'}</h3>
              <button type="button" className="settings-close" onClick={closeModal} aria-label="Close">
                ×
              </button>
            </div>
            <form onSubmit={submitModal} className="settings-employee-modal__form">
              <fieldset className="settings-employee-modal__fieldset">
                <legend className="settings-employee-modal__legend">Name &amp; role</legend>
                <div className="settings-employee-modal__grid">
                  <label>
                    <span className="label">First name *</span>
                    <input className="input" value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
                  </label>
                  <label>
                    <span className="label">Middle name</span>
                    <input className="input" value={middleName} onChange={(e) => setMiddleName(e.target.value)} />
                  </label>
                  <label>
                    <span className="label">Last name *</span>
                    <input className="input" value={lastName} onChange={(e) => setLastName(e.target.value)} required />
                  </label>
                  <label>
                    <span className="label">Title</span>
                    <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
                  </label>
                  <label>
                    <span className="label">Designation</span>
                    <input className="input" value={designation} onChange={(e) => setDesignation(e.target.value)} />
                  </label>
                  <label>
                    <span className="label">License number</span>
                    <input className="input" value={licenseNumber} onChange={(e) => setLicenseNumber(e.target.value)} />
                  </label>
                  <label className="settings-employee-modal__full">
                    <span className="label">Email</span>
                    <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, alignSelf: 'end' }}>
                    <input type="checkbox" checked={isProvider} onChange={(e) => setIsProvider(e.target.checked)} />
                    <span>Scheduling provider</span>
                  </label>
                </div>
              </fieldset>

              <fieldset className="settings-employee-modal__fieldset">
                <legend className="settings-employee-modal__legend">PIMS</legend>
                <div className="settings-employee-modal__grid">
                  <label>
                    <span className="label">PIMS ID</span>
                    <input className="input" value={pimsId} onChange={(e) => setPimsId(e.target.value)} />
                  </label>
                  <label>
                    <span className="label">PIMS user ID</span>
                    <input className="input" value={pimsUserId} onChange={(e) => setPimsUserId(e.target.value)} />
                  </label>
                  <label>
                    <span className="label">PIMS type</span>
                    <input className="input" value={pimsType} onChange={(e) => setPimsType(e.target.value)} placeholder="EVET" />
                  </label>
                </div>
              </fieldset>

              <fieldset className="settings-employee-modal__fieldset">
                <legend className="settings-employee-modal__legend">Address</legend>
                <div className="settings-employee-modal__grid">
                  <label className="settings-employee-modal__full">
                    <span className="label">Address line 1</span>
                    <input className="input" value={address1} onChange={(e) => setAddress1(e.target.value)} />
                  </label>
                  <label className="settings-employee-modal__full">
                    <span className="label">Address line 2</span>
                    <input className="input" value={address2} onChange={(e) => setAddress2(e.target.value)} />
                  </label>
                  <label className="settings-employee-modal__full">
                    <span className="label">Address line 3</span>
                    <input className="input" value={address3} onChange={(e) => setAddress3(e.target.value)} />
                  </label>
                  <label>
                    <span className="label">City</span>
                    <input className="input" value={city} onChange={(e) => setCity(e.target.value)} />
                  </label>
                  <label>
                    <span className="label">State</span>
                    <input className="input" value={stateAbbr} onChange={(e) => setStateAbbr(e.target.value)} />
                  </label>
                  <label>
                    <span className="label">ZIP</span>
                    <input className="input" value={zipcode} onChange={(e) => setZipcode(e.target.value)} />
                  </label>
                  <label>
                    <span className="label">County</span>
                    <input className="input" value={county} onChange={(e) => setCounty(e.target.value)} />
                  </label>
                  <label>
                    <span className="label">Country</span>
                    <input
                      className="input"
                      value={country}
                      onChange={(e) => setCountry(e.target.value)}
                      placeholder="e.g. 1 or US"
                    />
                  </label>
                </div>
              </fieldset>

              <fieldset className="settings-employee-modal__fieldset">
                <legend className="settings-employee-modal__legend">Phone</legend>
                <div className="settings-employee-modal__grid">
                  <label>
                    <span className="label">Phone 1</span>
                    <input className="input" type="tel" value={phone1} onChange={(e) => setPhone1(e.target.value)} />
                  </label>
                  <label>
                    <span className="label">Phone 2</span>
                    <input className="input" type="tel" value={phone2} onChange={(e) => setPhone2(e.target.value)} />
                  </label>
                </div>
              </fieldset>

              <fieldset className="settings-employee-modal__fieldset">
                <legend className="settings-employee-modal__legend">Default inventory</legend>
                <p className="muted" style={{ fontSize: 12, margin: '0 0 8px' }}>
                  Used for checkout stock draws when Progress has not been started for the day.
                  Progress also updates these when you save day times.
                </p>
                <div className="settings-employee-modal__grid">
                  <label>
                    <span className="label">Default branch</span>
                    <select
                      className="input"
                      value={defaultBranchId ?? ''}
                      onChange={(e) => {
                        const v = e.target.value === '' ? null : Number(e.target.value);
                        setDefaultBranchId(v != null && Number.isFinite(v) ? v : null);
                        setDefaultLocationId(null);
                      }}
                    >
                      <option value="">Select branch…</option>
                      {branchOptions.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span className="label">Default location</span>
                    <select
                      className="input"
                      value={defaultLocationId ?? ''}
                      disabled={defaultBranchId == null}
                      onChange={(e) => {
                        const v = e.target.value === '' ? null : Number(e.target.value);
                        setDefaultLocationId(v != null && Number.isFinite(v) ? v : null);
                      }}
                    >
                      <option value="">Select location…</option>
                      {locationOptions.map((loc) => (
                        <option key={loc.id} value={loc.id}>
                          {loc.name}
                          {loc.isDefault ? ' (default)' : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </fieldset>

              <fieldset className="settings-employee-modal__fieldset">
                <legend className="settings-employee-modal__legend">Roles</legend>
                <p className="muted" style={{ fontSize: 12, margin: '0 0 8px' }}>
                  Practice-wide Scout roles only. Branch-specific roles are on{' '}
                  <a href="/schedule/settings?tab=roles">Staff → Roles</a>.
                </p>
                {roleGroups.length === 0 ? (
                  <p className="muted" style={{ fontSize: 13, margin: 0 }}>
                    No practice-wide Scout roles loaded.
                  </p>
                ) : (
                  <div className="settings-employee-modal__roles" role="group" aria-label="Employee roles">
                    {roleGroups.map((group) => (
                      <label
                        key={group.nameKey}
                        style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, cursor: 'pointer' }}
                      >
                        <input
                          type="checkbox"
                          checked={isEmployeeRoleNameGroupSelected(group, roleIdsSelected)}
                          onChange={(e) => toggleRoleGroup(group.nameKey, e.target.checked)}
                        />
                        <span>{group.displayName}</span>
                      </label>
                    ))}
                  </div>
                )}
              </fieldset>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
                <button type="button" className="btn secondary" onClick={closeModal} disabled={saving}>
                  Cancel
                </button>
                <button type="submit" className="btn" disabled={saving}>
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}

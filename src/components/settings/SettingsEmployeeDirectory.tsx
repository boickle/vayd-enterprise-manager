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
  getControlledDrugLocation,
  setControlledDrugLocation,
  listInventoryBranchLocations,
  listPracticeBranches,
  setEmployeeBranches,
  type InventoryBranchLocation,
  type PracticeBranch,
} from '../../api/branchInventory';
import { appAlert, appConfirm } from '../../utils/appDialog';
import {
  cancelOffboarding,
  recordLastDay,
  fetchDeactivatedStaff,
  type DeactivatedStaffRow,
} from '../../api/offboarding';
import OffboardDialog from './OffboardDialog';
import {
  createStaffLogin,
  getStaffLogin,
  setStaffWorksWith,
  type StaffLogin,
} from '../../api/users';
import { usePermissions } from '../../permissions/PermissionContext';
import {
  displayNameForQuoLine,
  useOpenPhoneLineDirectory,
} from '../../hooks/useOpenPhoneLineDirectory';
import { formatDisplayPhone, phonesMatchForQuo } from '../../utils/quoContact';
import { formatEmployeeDisplayName } from '../../utils/employeeDisplayName';
import { formatYmd } from '../../utils/formatYmd';
import dayjs from 'dayjs';
import { scoutManagedState } from '../../utils/pimsScoutManaged';
import { loadProviderSignature, saveProviderSignature } from '../../utils/practiceLetterhead';
import {
  assignEmployeeRoleNameGroup,
  groupEmployeeRolesByName,
  isEmployeeRoleNameGroupSelected,
} from '../../utils/employeeRoleDisplay';
import SignaturePad from '../SignaturePad';
import SettingsEmployeeAccess from './SettingsEmployeeAccess';
import ViewAsButton from '../ViewAsButton';
import { currentPracticeId } from '../../utils/practiceIdFromToken';
import {
  loadPracticeLicenses,
  saveEmployeeLicenses,
} from '../../api/employeeLicenses';
import {
  fetchQuoUsers,
  fetchUnlinkedQuoCallers,
  dismissUnlinkedQuoCalls,
  fetchActiveStaffWithLoginOff,
  unlinkedCallerLabel,
  quoUserMatchingEmail,
  QUO_NONE,
  type QuoUsersResponse,
  type UnlinkedQuoCaller,
} from '../../api/quoUsers';

const DEFAULT_PRACTICE_ID = currentPracticeId();
const ALL_OFFICES = 'all';

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

/**
 * COM-CALL: the Quo choice on file — a Quo user id, QUO_NONE for "Doesn't use Quo", or '' when
 * nobody has chosen yet.
 */
export function savedQuoChoice(e: Employee | Record<string, unknown> | null | undefined): string {
  const r = (e ?? {}) as Record<string, unknown>;
  const uid = typeof r.openPhoneUserId === 'string' ? r.openPhoneUserId.trim() : '';
  if (uid) return uid;
  return r.doesNotUseQuo === true ? QUO_NONE : '';
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
  | 'access';

const HUB_SECTIONS: { id: EmployeeHubSection; label: string }[] = [
  { id: 'profile', label: 'Profile' },
  { id: 'schedule', label: 'Schedule' },
  { id: 'types', label: 'Appointment types' },
  { id: 'goals', label: 'Goals' },
  { id: 'access', label: 'Access' },
];

type Props = {
  onMessage?: (msg: string, kind: 'success' | 'error') => void;
  section?: EmployeeHubSection;
  onSectionChange?: (section: EmployeeHubSection) => void;
  selectedEmployeeId?: number | null;
  onSelectedEmployeeIdChange?: (id: number | null) => void;
  /** Staff photo controls, rendered on the Profile tab. */
  profilePhoto?: ReactNode;
  extra?: ReactNode;
};

export default function SettingsEmployeeDirectory({
  onMessage,
  section: requestedSection = 'profile',
  onSectionChange,
  selectedEmployeeId,
  onSelectedEmployeeIdChange,
  profilePhoto,
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
  /**
   * Licenses per state (owner, Nov 12, 2026; DEA numbers stay in Vet Snap). The practice-state license
   * is also kept in licenseNumber, which certificates and Rx labels print.
   */
  const [licenseRows, setLicenseRows] = useState<LicenseRow[]>([]);
  const [practiceState, setPracticeState] = useState('ME');
  const [signatureImage, setSignatureImage] = useState<string | null>(null);
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
  const [quoLinePhone, setQuoLinePhone] = useState('');
  /** Typing a number that isn't one of the Quo lines. */
  const [quoCustom, setQuoCustom] = useState(false);
  /** COM-CALL: practice Quo users and whether Quo is on (then a Quo choice is required). */
  const [quoInfo, setQuoInfo] = useState<QuoUsersResponse | null>(null);
  const [unlinkedCallers, setUnlinkedCallers] = useState<UnlinkedQuoCaller[]>([]);
  const [dismissingQuoUser, setDismissingQuoUser] = useState<string | null>(null);
  /** Active staff whose login is turned off in Admin → Users (offboard them). */
  const [loginOffIds, setLoginOffIds] = useState<Set<number>>(new Set());
  /** Quo choice on file for the person being edited ('' = none yet). */
  const [quoSaved, setQuoSaved] = useState('');
  /** What the user picked in the form; null while untouched. */
  const [quoPicked, setQuoPicked] = useState<string | null>(null);
  const [worksWithDoctorId, setWorksWithDoctorId] = useState<number | null>(null);
  const [worksWithDefault, setWorksWithDefault] = useState(false);
  const [creatingLogin, setCreatingLogin] = useState(false);
  const [roleIdsSelected, setRoleIdsSelected] = useState<number[]>([]);
  const [rolesCatalog, setRolesCatalog] = useState<EmployeeRole[]>([]);
  const [rolesEditEmployee, setRolesEditEmployee] = useState<Employee | null>(null);
  const [bioEditEmployee, setBioEditEmployee] = useState<Employee | null>(null);
  const [bioText, setBioText] = useState('');
  const [branchOptions, setBranchOptions] = useState<PracticeBranch[]>([]);
  const [locationOptions, setLocationOptions] = useState<InventoryBranchLocation[]>([]);
  /**
   * Controlled drug location (their safe): licensed veterinarian providers only (owner decisions,
   * Oct 30, 2026). Their controlled charges take lots from it and need it to be set.
   */
  const [vetLicensed, setVetLicensed] = useState(false);
  const [controlledLocationId, setControlledLocationId] = useState<number | null>(null);
  const [controlledLocationOptions, setControlledLocationOptions] = useState<
    Array<{ id: number; label: string }>
  >([]);
  const [defaultBranchId, setDefaultBranchId] = useState<number | null>(null);
  const [defaultLocationId, setDefaultLocationId] = useState<number | null>(null);
  const [practiceWide, setPracticeWide] = useState(false);
  const [loginUser, setLoginUser] = useState<StaffLogin | null>(null);
  const [loadedEmployee, setLoadedEmployee] = useState<Employee | null>(null);
  const [sigEditing, setSigEditing] = useState(false);
  const [sigDraft, setSigDraft] = useState<string | null>(null);
  const [sigSaving, setSigSaving] = useState(false);
  /** RP-03: the Offboard dialog replaces Deactivate. */
  const [offboardEmp, setOffboardEmp] = useState<Employee | null>(null);
  /** Deactivated people and people with a last day set (GET /employee-offboarding/deactivated). */
  const [departed, setDeparted] = useState<DeactivatedStaffRow[]>([]);
  /** Deactivated person: the last day being typed (keyed by employee id). */
  const [lastDayDraft, setLastDayDraft] = useState<{ id: number; value: string } | null>(null);
  const [lastDaySaving, setLastDaySaving] = useState(false);
  const [showDeactivated, setShowDeactivated] = useState(false);

  const practice = useMemo(() => ({ id: DEFAULT_PRACTICE_ID }), []);
  const { can } = usePermissions();
  /** Practice manager and above add employees and edit their records (owner decision, Nov 2, 2026). */
  const canManageStaff = can('staff.employee.manage');
  const canManageLogins = can('staff.login.manage');
  /**
   * The Medical Director sets licenses but doesn't manage staff (D1; owner, Nov 9, 2026): they see the
   * Access tab only. Anyone who manages staff, logins or roles sees every tab.
   */
  const accessOnly =
    !canManageStaff && !canManageLogins && !can('staff.role.assign') && can('staff.license.manage');
  const section: EmployeeHubSection = accessOnly ? 'access' : requestedSection;
  const hubSections = accessOnly ? HUB_SECTIONS.filter((item) => item.id === 'access') : HUB_SECTIONS;
  const { lines: quoLines } = useOpenPhoneLineDirectory(isProvider);
  const quoMatch = quoLinePhone.trim()
    ? quoLines.find((line) => phonesMatchForQuo(line.phone, quoLinePhone))
    : undefined;
  const quoSelectValue = quoCustom || (quoLinePhone.trim() && !quoMatch)
    ? '__custom__'
    : (quoMatch?.phone ?? '');
  /**
   * COM-CALL: email matching only suggests. With nothing on file, the Quo user whose email matches
   * is pre-selected and marked "(matches email — confirm)"; nothing is saved until Save.
   */
  const quoSuggestion =
    quoInfo?.quoEnabled && !quoSaved
      ? quoUserMatchingEmail(quoInfo.users, loginUser?.email ?? email)
      : undefined;
  const quoChoice = quoPicked ?? (quoSaved || quoSuggestion?.id || '');
  const quoSuggestedShown = quoPicked == null && !quoSaved && quoSuggestion != null;
  const quoChoiceRequired =
    quoInfo?.quoEnabled === true &&
    (modalMode === 'add' || loadedEmployee == null || empActive(loadedEmployee));

  const applyStaffLogin = (login: StaffLogin | null) => {
    setLoginUser(login);
    setWorksWithDoctorId(login?.doctorId ?? null);
    setWorksWithDefault(login?.isDoctorDefault === true);
  };

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
      const [list, gone] = await Promise.all([
        fetchAllEmployees(),
        fetchDeactivatedStaff().catch(() => [] as DeactivatedStaffRow[]),
      ]);
      setRows(Array.isArray(list) ? list : []);
      setDeparted(gone);
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

  // COM-CALL: who can edit staff profiles sees the Quo user field and the unlinked-caller notice.
  useEffect(() => {
    if (!canManageStaff) return;
    let cancelled = false;
    void fetchQuoUsers()
      .then((info) => {
        if (!cancelled) setQuoInfo(info);
      })
      .catch(() => undefined);
    void fetchUnlinkedQuoCallers()
      .then((list) => {
        if (!cancelled) setUnlinkedCallers(list);
      })
      .catch(() => undefined);
    void fetchActiveStaffWithLoginOff()
      .then((ids) => {
        if (!cancelled) setLoginOffIds(new Set(ids));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [canManageStaff, rows]);

  const openAdd = () => {
    setEditingId(null);
    setFirstName('');
    setLastName('');
    setMiddleName('');
    setEmail('');
    setTitle('');
    setDesignation('');
    setLicenseNumber('');
    setLicenseRows([]);
    setSignatureImage(null);
    setPimsId('');
    setPimsUserId('');
    setPimsType('VAYD');
    setIsProvider(false);
    applyStaffLogin(null);
    setQuoLinePhone('');
    setQuoSaved('');
    setQuoPicked(null);
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
    setPracticeWide(false);
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
    setLicenseRows(
      str(r.licenseNumber) ? [{ state: practiceState, number: str(r.licenseNumber) }] : [],
    );
    if (full.id != null) {
      const empId = Number(full.id);
      void loadPracticeLicenses(true)
        .then((all) => {
          setPracticeState(all.practiceState);
          setLicenseRows(
            all.licenses
              .filter((l) => l.employeeId === empId && l.kind === 'veterinary')
              .map((l) => ({ state: l.state, number: l.number })),
          );
        })
        .catch(() => undefined);
    }
    const storedSig =
      typeof r.signatureImage === 'string' && r.signatureImage.startsWith('data:image/')
        ? r.signatureImage
        : null;
    setSignatureImage(storedSig);
    setSigEditing(false);
    setSigDraft(null);
    if (full.id != null && !storedSig) {
      void loadProviderSignature(Number(full.id)).then((sig) => {
        if (sig) setSignatureImage(sig);
      });
    }
    setPimsId(str(r.pimsId));
    setPimsUserId(str(r.pimsUserId));
    setPimsType(str(r.pimsType) || 'EVET');
    setIsProvider(full.isProvider === true);
    setVetLicensed(
      r.isLicensed === true && String(r.licenseType ?? '').toLowerCase() === 'veterinarian'
    );
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
    setQuoLinePhone(str(r.quoLinePhone));
    setQuoCustom(false);
    setQuoSaved(savedQuoChoice(full));
    setQuoPicked(null);
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
      setPracticeWide(empBranches.length > 0 && !empBranches.some((b) => b.isPrimary));
      const primary = empBranches.find((b) => b.isPrimary) ?? empBranches[0] ?? null;
      const seedBranch =
        primary?.branchId ??
        branchList.find((b) => b.isDefault)?.id ??
        branchList[0]?.id ??
        null;
      setDefaultBranchId(seedBranch);
      setDefaultLocationId(primary?.defaultInventoryLocationId ?? null);
      void getControlledDrugLocation(DEFAULT_PRACTICE_ID, id)
        .then((loc) => setControlledLocationId(loc?.locationId ?? null))
        .catch(() => setControlledLocationId(null));
      void Promise.all(
        branchList
          .filter((b) => b.isActive !== false)
          .map((b) =>
            listInventoryBranchLocations(DEFAULT_PRACTICE_ID, b.id)
              .then((locs) =>
                locs
                  .filter((l) => l.isActive !== false)
                  .map((l) => ({ id: l.id, label: `${b.name} → ${l.name}` }))
              )
              .catch(() => [])
          )
      ).then((lists) => setControlledLocationOptions(lists.flat()));
      applyStaffLogin(await getStaffLogin(DEFAULT_PRACTICE_ID, id).catch(() => null));
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
      licenseNumber: primaryLicenseFromRows(licenseRows, practiceState) ?? blankToNull(licenseNumber),
      signatureImage,
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
      quoLinePhone: blankToNull(quoLinePhone),
      practice,
      isActive: true,
      isDeleted: false,
    };
    // COM-CALL: with Quo on, the profile always sends its Quo choice (the API refuses a blank one).
    if (quoInfo?.quoEnabled) payload.quoUserChoice = quoChoice;
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
    if (isProvider && vetLicensed) {
      await setControlledDrugLocation(DEFAULT_PRACTICE_ID, id, controlledLocationId);
    }
    if (practiceWide) {
      await setEmployeeBranches(DEFAULT_PRACTICE_ID, id, {
        branchIds: branchOptions.map((b) => b.id),
        practiceWide: true,
      });
    } else if (defaultBranchId != null) {
      const existing = await getEmployeeBranches(DEFAULT_PRACTICE_ID, id).catch(() => []);
      const wasPracticeWide = existing.length > 0 && !existing.some((b) => b.isPrimary);
      const branchIds =
        existing.length > 0 && !wasPracticeWide
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
    if (quoChoiceRequired && !quoChoice) {
      onMessage?.(
        'Choose this person’s Quo user, or “Doesn’t use Quo”. Their calls reach their call dock through it.',
        'error'
      );
      return;
    }
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
      const practiceRef = (full.practice ?? prev.practice ?? practice) as
        | { id?: number }
        | null
        | undefined;
      const practiceId = Number(practiceRef?.id);
      const merged: EmployeeDto = {
        ...prev,
        ...form,
        id: editingId,
        created: undefined,
        updated: undefined,
        externalCreated: undefined,
        externalUpdated: undefined,
        weeklySchedules: undefined,
        appointmentTypes: undefined,
        species: undefined,
        roleAssignments: undefined,
        practice:
          Number.isFinite(practiceId) && practiceId > 0 ? { id: practiceId } : practice,
        isActive: prev.isActive !== false,
        isDeleted: prev.isDeleted === true,
      } as EmployeeDto;
      await saveEmployees(merged);
      await saveEmployeeLicenses(
        editingId,
        Number.isFinite(practiceId) && practiceId > 0 ? practiceId : DEFAULT_PRACTICE_ID,
        licenseRows.filter((l) => l.number.trim()),
      );
      await saveProviderSignature(editingId, signatureImage);
      await saveOfficeAndRoles(editingId);
      if (
        loginUser &&
        (worksWithDoctorId !== (loginUser.doctorId ?? null) ||
          worksWithDefault !== loginUser.isDoctorDefault)
      ) {
        applyStaffLogin(
          await setStaffWorksWith(DEFAULT_PRACTICE_ID, editingId, {
            doctorId: worksWithDoctorId,
            isDoctorDefault: worksWithDoctorId != null && worksWithDefault,
          })
        );
      }
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

  const createLogin = async () => {
    if (editingId == null) return;
    if (email.trim() !== str(loadedEmployee?.email).trim()) {
      onMessage?.('Save the new email first, then create the login.', 'error');
      return;
    }
    setCreatingLogin(true);
    try {
      const res = await createStaffLogin(DEFAULT_PRACTICE_ID, editingId);
      applyStaffLogin(res?.login ?? null);
      onMessage?.(`Login created. ${email.trim()} was emailed a temporary password.`, 'success');
    } catch (err) {
      onMessage?.(extractErr(err), 'error');
    } finally {
      setCreatingLogin(false);
    }
  };

  const offboardDone = async (result: {
    completedAt: string | null;
    lastDay: string;
    rebookTaskId: number | null;
  }) => {
    setOffboardEmp(null);
    const rebook =
      result.rebookTaskId != null
        ? ' A “Rebook” task lists the visits still booked with them.'
        : '';
    onMessage?.(
      result.completedAt
        ? `Offboarded. Their login has ended and their work has been handed over.${rebook}`
        : `Offboarded. Their last day is ${formatYmd(result.lastDay)}; their login ends at midnight that night.${rebook}`,
      'success'
    );
    await load();
  };

  const cancelScheduledOffboard = async (employeeId: number) => {
    const ok = await appConfirm({
      title: 'Cancel offboarding?',
      message: 'Their last day is removed and nothing will change for them.',
      confirmLabel: 'Cancel offboarding',
    });
    if (!ok) return;
    try {
      await cancelOffboarding(employeeId);
      onMessage?.('Offboarding cancelled.', 'success');
      await load();
    } catch (err) {
      onMessage?.(extractErr(err), 'error');
    }
  };

  const saveLastDay = async (employeeId: number, lastDay: string) => {
    if (!lastDay) return;
    setLastDaySaving(true);
    try {
      await recordLastDay(employeeId, lastDay);
      onMessage?.(`Last day saved: ${formatYmd(lastDay)}. Their goals stop counting after it.`, 'success');
      setLastDayDraft(null);
      await load();
    } catch (err) {
      onMessage?.(extractErr(err), 'error');
    } finally {
      setLastDaySaving(false);
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
      onMessage?.(
        'Employee reactivated. Their login stays off until an admin turns it on in Admin → Users.',
        'success'
      );
      await load();
    } catch (err) {
      onMessage?.(extractErr(err), 'error');
    }
  };

  const removeRow = async (emp: Employee) => {
    const ok = await appConfirm({
      title: 'Delete employee?',
      message: `Permanently delete employee #${emp.id}? Only for a duplicate added by mistake. For anyone who worked here, use Offboard.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteEmployees([emp.id]);
      onMessage?.('Employee deleted.', 'success');
      await load();
    } catch (err) {
      // RP-A6: a person with records on file is refused (409); say so in a dialog, not a passing banner.
      await appAlert({ title: "Can't delete this person", message: extractErr(err) });
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

  /** Deactivated (or past their last day): listed only with "Show deactivated". */
  const deactivatedRows = useMemo(
    () => departed.filter((d) => !d.isActive && !rows.some((r) => r.id === d.id && empActive(r))),
    [departed, rows]
  );
  const lastDayById = useMemo(
    () => new Map(departed.filter((d) => d.lastDay).map((d) => [d.id, d.lastDay as string])),
    [departed]
  );
  /** The selected person, whether active or deactivated. */
  const editingRow: Employee | null = useMemo(() => {
    if (editingId == null) return null;
    const active = rows.find((r) => r.id === editingId);
    if (active) return active;
    const gone = deactivatedRows.find((d) => d.id === editingId);
    return gone ? ({ ...gone, isActive: false } as unknown as Employee) : null;
  }, [editingId, rows, deactivatedRows]);
  const offboardColleagues = useMemo(
    () =>
      sorted
        .filter((r) => empActive(r))
        .map((r) => ({
          id: r.id,
          name: formatEmployeeDisplayName(r),
          isProvider: r.isProvider === true,
        })),
    [sorted]
  );

  /** Active scheduling providers someone can work with. */
  const doctorOptions = useMemo(
    () =>
      sorted.filter(
        (emp) =>
          emp.id !== editingId &&
          // The current link stays listed even if that doctor is inactive.
          ((emp.isProvider === true && empActive(emp)) || emp.id === loginUser?.doctorId)
      ),
    [sorted, editingId, loginUser?.doctorId]
  );

  const selectEmployee = (id: number) => {
    onSelectedEmployeeIdChange?.(id);
    void openEdit(id);
  };

  const persistSignature = async (value: string | null) => {
    if (editingId == null) return;
    setSigSaving(true);
    try {
      await saveProviderSignature(editingId, value);
      setSignatureImage(value);
      setSigEditing(false);
      setSigDraft(null);
      onMessage?.('Signature saved.', 'success');
    } catch (err) {
      onMessage?.(extractErr(err), 'error');
    } finally {
      setSigSaving(false);
    }
  };

  const signatureEditor = (
    <div className="settings-staff-signature">
      {signatureImage && !sigEditing ? (
        <img src={signatureImage} alt="Provider signature" className="settings-staff-signature__preview" />
      ) : (
        <p className="settings-muted" style={{ margin: '0 0 8px' }}>
          {sigEditing ? 'Draw below or upload a PNG / JPEG.' : 'No signature on file yet.'}
        </p>
      )}
      {sigEditing && canManageStaff ? (
        <>
          <SignaturePad onChange={(dataUrl) => setSigDraft(dataUrl || null)} />
          <input
            className="settings-input"
            type="file"
            accept="image/png,image/jpeg"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const reader = new FileReader();
              reader.onload = () => {
                setSigDraft(typeof reader.result === 'string' ? reader.result : null);
              };
              reader.readAsDataURL(file);
            }}
          />
          {sigDraft ? (
            <img src={sigDraft} alt="Signature preview" className="settings-staff-signature__preview" />
          ) : null}
          <div className="settings-staff-signature__actions">
            <button
              type="button"
              className="btn"
              disabled={sigSaving || !sigDraft}
              onClick={() => void persistSignature(sigDraft)}
            >
              {sigSaving ? 'Saving…' : 'Save signature'}
            </button>
            <button
              type="button"
              className="btn secondary"
              onClick={() => {
                setSigEditing(false);
                setSigDraft(null);
              }}
            >
              Cancel
            </button>
          </div>
        </>
      ) : !canManageStaff ? (
        <p className="settings-muted" style={{ margin: 0 }}>
          A practice manager adds or changes signatures.
        </p>
      ) : (
        <div className="settings-staff-signature__actions">
          <button
            type="button"
            className="btn secondary"
            onClick={() => {
              setSigEditing(true);
              setSigDraft(signatureImage);
            }}
          >
            {signatureImage ? 'Replace signature' : 'Add signature'}
          </button>
          {signatureImage ? (
            <button
              type="button"
              className="btn secondary"
              disabled={sigSaving}
              onClick={() => void persistSignature(null)}
            >
              Clear
            </button>
          ) : null}
        </div>
      )}
    </div>
  );

  const ownership = scoutManagedState(
    loadedEmployee as unknown as Record<string, unknown> | null,
    'employee'
  );
  const emailLocked = loginUser != null;

  /** COM-CALL: active staff with neither a Quo user nor "Doesn't use Quo". */
  const quoNotLinked = (emp: Employee): boolean =>
    quoInfo?.quoEnabled === true && empActive(emp) && !savedQuoChoice(emp);
  const quoNotLinkedCount = sorted.filter(quoNotLinked).length;
  const loginOff = (emp: Employee): boolean => empActive(emp) && loginOffIds.has(Number(emp.id));
  const loginOffCount = sorted.filter(loginOff).length;

  const quoKnownIds = new Set((quoInfo?.users ?? []).map((u) => u.id));
  const quoUserField = quoInfo?.quoEnabled ? (
    <label className="settings-employee-modal__full">
      <span className="label">Quo user{quoChoiceRequired ? ' (required)' : ''}</span>
      <select
        className="input"
        aria-label="Quo user"
        value={quoChoice}
        required={quoChoiceRequired}
        onChange={(e) => setQuoPicked(e.target.value)}
      >
        <option value="">Choose…</option>
        {(quoInfo.users ?? []).map((u) => (
          <option key={u.id} value={u.id}>
            {u.name}
            {u.email && u.email !== u.name ? ` · ${u.email}` : ''}
            {quoSuggestedShown && quoSuggestion?.id === u.id ? ' (matches email — confirm)' : ''}
          </option>
        ))}
        {quoChoice && quoChoice !== QUO_NONE && !quoKnownIds.has(quoChoice) ? (
          <option value={quoChoice}>Quo user {quoChoice} (not in Quo’s list)</option>
        ) : null}
        <option value={QUO_NONE}>Doesn’t use Quo</option>
      </select>
      <p className="muted" style={{ fontSize: 12, margin: '6px 0 0' }}>
        {quoSuggestedShown
          ? 'Picked because the email matches. Check it’s the right person, then Save. '
          : ''}
        Calls this person answers or makes in Quo land in their call dock. Each Quo user belongs to
        one person.
        {quoInfo.error ? ` ${quoInfo.error}` : ''}
      </p>
    </label>
  ) : null;

  return (
    <div className="settings-employee-directory">
      <p className="settings-section-description" style={{ marginTop: 0 }}>
        Choose a person, then use the tabs for profile, schedule (hours, offices, and zones),
        appointment types, and goals.
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
                  {empActive(emp) ? '' : ' (Deactivated)'}
                  {empActive(emp) && lastDayById.get(emp.id)
                    ? ` · Last day ${formatYmd(lastDayById.get(emp.id))}`
                    : ''}
                  {loginOff(emp) ? ' · Login off — offboard?' : ''}
                  {quoNotLinked(emp) ? ' · Quo: not linked' : ''}
                </option>
              ))}
              {showDeactivated
                ? deactivatedRows.map((emp) => (
                    <option key={`gone-${emp.id}`} value={emp.id}>
                      {employeeDisplayName(emp as unknown as Employee)}
                      {emp.isProvider ? ' · Provider' : ''}
                      {' (Deactivated)'}
                    </option>
                  ))
                : null}
            </select>
          </label>
          <label
            className="settings-employee-hub__show-deactivated"
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <input
              type="checkbox"
              checked={showDeactivated}
              onChange={(e) => setShowDeactivated(e.target.checked)}
            />
            Show deactivated ({deactivatedRows.length})
          </label>
          <div className="settings-employee-hub__toolbar-actions">
            {canManageStaff ? (
              <button type="button" className="btn" onClick={openAdd}>
                Add
              </button>
            ) : null}
            <button type="button" className="btn secondary" onClick={() => void load()}>
              Refresh
            </button>
          </div>
        </div>
        {loadError && <div className="settings-error-message">{loadError}</div>}
        {canManageStaff && unlinkedCallers.length > 0 ? (
          <div className="settings-message settings-warning-message" role="status" style={{ display: 'block' }}>
            {unlinkedCallers.map((u) => {
              const who = unlinkedCallerLabel(u);
              const oldLogin = u.inQuo === false || !!u.formerStaffName;
              return (
                <div key={u.quoUserId} style={{ margin: '0 0 8px' }}>
                  <p style={{ margin: '0 0 4px' }}>
                    Calls taken in Quo by <strong>{who}</strong> don’t reach anyone’s call dock
                    {u.waitingCalls > 0
                      ? ` — ${u.waitingCalls} waiting ${u.waitingCalls === 1 ? 'call' : 'calls'}`
                      : ''}
                    .{' '}
                    {oldLogin
                      ? 'If someone now uses this Quo login, choose it as their Quo user on their profile. Otherwise dismiss the calls.'
                      : 'Choose this Quo user on their staff profile (Quo user).'}
                  </p>
                  {u.waitingCalls > 0 ? (
                    <button
                      type="button"
                      className="btn secondary"
                      disabled={dismissingQuoUser === u.quoUserId}
                      onClick={async () => {
                        const ok = window.confirm(
                          `Dismiss ${u.waitingCalls} waiting ${u.waitingCalls === 1 ? 'call' : 'calls'} from ${who}? ` +
                            'They won’t be filed to any chart. Calls another staff member took are not affected.'
                        );
                        if (!ok) return;
                        setDismissingQuoUser(u.quoUserId);
                        try {
                          await dismissUnlinkedQuoCalls(u.quoUserId);
                          setUnlinkedCallers(await fetchUnlinkedQuoCallers());
                        } catch (e) {
                          setLoadError(extractErr(e));
                        } finally {
                          setDismissingQuoUser(null);
                        }
                      }}
                    >
                      {dismissingQuoUser === u.quoUserId ? 'Dismissing…' : 'Dismiss these calls'}
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}
        {loginOffCount > 0 ? (
          <p className="settings-muted" style={{ margin: '4px 0 8px' }}>
            Login off for {loginOffCount} active {loginOffCount === 1 ? 'person' : 'people'}{' '}
            (marked “Login off” in the Staff list). They can’t sign in but still appear on
            schedules and staff lists. Open their profile and offboard them.
          </p>
        ) : null}
        {quoNotLinkedCount > 0 ? (
          <p className="settings-muted" style={{ margin: '4px 0 8px' }}>
            Quo: not linked for {quoNotLinkedCount} active{' '}
            {quoNotLinkedCount === 1 ? 'person' : 'people'} (marked in the Staff list). Open their
            Profile and choose their Quo user, or “Doesn’t use Quo”.
          </p>
        ) : null}

        {editingId == null ? (
          <div className="settings-card">
            <p className="settings-muted" style={{ margin: 0 }}>
              Select an employee to manage their profile, default office, and schedule.
            </p>
          </div>
        ) : (
          <>
              <div className="settings-employee-hub__sections" role="tablist" aria-label="Employee sections">
                {hubSections.map((item) => (
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
                      {practiceWide
                        ? 'Works across every office: sees every office’s unassigned tasks. Used for managers, admins and CSRs.'
                        : 'Checkout takes inventory from this office unless someone changes it on the invoice.'}
                    </p>
                    <div className="settings-employee-modal__grid">
                      <label>
                        <span className="label">Default branch</span>
                        <select
                          className="input"
                          value={practiceWide ? ALL_OFFICES : (defaultBranchId ?? '')}
                          onChange={(e) => {
                            if (e.target.value === ALL_OFFICES) {
                              setPracticeWide(true);
                              setDefaultLocationId(null);
                              return;
                            }
                            setPracticeWide(false);
                            const v = e.target.value === '' ? null : Number(e.target.value);
                            setDefaultBranchId(v != null && Number.isFinite(v) ? v : null);
                            setDefaultLocationId(null);
                          }}
                        >
                          <option value="">Select branch…</option>
                          <option value={ALL_OFFICES}>All offices (practice-wide)</option>
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
                          value={practiceWide ? '' : (defaultLocationId ?? '')}
                          disabled={practiceWide || defaultBranchId == null}
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

                  {isProvider && !vetLicensed ? (
                    <p className="muted" style={{ fontSize: 12, margin: '-4px 0 12px' }}>
                      A veterinarian’s controlled drug location is set here once they’re marked as
                      a licensed veterinarian on the Access tab.
                    </p>
                  ) : null}
                  {isProvider && vetLicensed ? (
                    <fieldset className="settings-employee-modal__fieldset">
                      <legend className="settings-employee-modal__legend">Controlled drug location</legend>
                      <p className="muted" style={{ fontSize: 12, margin: '0 0 8px' }}>
                        Where this doctor’s controlled drugs live (their safe). Checkout picks
                        their controlled drug lots from here, and the Controlled Drugs report checks
                        their doses against it. Controlled drugs can’t be charged under them until
                        it’s set.
                      </p>
                      <label>
                        <span className="label">Location</span>
                        <select
                          className="input"
                          value={controlledLocationId ?? ''}
                          onChange={(e) => {
                            const v = e.target.value === '' ? null : Number(e.target.value);
                            setControlledLocationId(v != null && Number.isFinite(v) ? v : null);
                          }}
                        >
                          <option value="">Not set — can’t charge controlled drugs</option>
                          {controlledLocationOptions.map((loc) => (
                            <option key={loc.id} value={loc.id}>
                              {loc.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </fieldset>
                  ) : null}

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
                            <a href={`/admin/users?user=${loginUser.userId}`}>Edit it on Users</a>
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
                      {isProvider ? (
                        <label>
                          <span className="label">Quo line</span>
                          <select
                            className="input"
                            value={quoSelectValue}
                            onChange={(e) => {
                              const v = e.target.value;
                              if (v === '__custom__') {
                                setQuoCustom(true);
                                if (quoMatch) setQuoLinePhone('');
                                return;
                              }
                              setQuoCustom(false);
                              setQuoLinePhone(v);
                            }}
                          >
                            <option value="">None (use Phone)</option>
                            {quoLines.map((line) => (
                              <option key={line.phone} value={line.phone}>
                                {displayNameForQuoLine(line)} · {formatDisplayPhone(line.phone)}
                              </option>
                            ))}
                            <option value="__custom__">Other number…</option>
                          </select>
                          {quoSelectValue === '__custom__' ? (
                            <input
                              className="input"
                              type="tel"
                              style={{ marginTop: 6 }}
                              value={quoLinePhone}
                              placeholder="+1 (207) 555-0123"
                              onChange={(e) => setQuoLinePhone(e.target.value)}
                            />
                          ) : null}
                          <p className="muted" style={{ fontSize: 12, margin: '6px 0 0' }}>
                            Texts to their clients come from this line. Blank uses Phone, then the
                            practice line.
                          </p>
                        </label>
                      ) : null}
                      {quoUserField}
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
                    <legend className="settings-employee-modal__legend">State licenses</legend>
                    <LicenseRowsEditor rows={licenseRows} practiceState={practiceState} onChange={setLicenseRows} />
                  </fieldset>

                  <fieldset className="settings-employee-modal__fieldset">
                    <legend className="settings-employee-modal__legend">Login and works with</legend>
                    {loginUser ? (
                      <>
                        <p className="muted" style={{ fontSize: 12, margin: '0 0 8px' }}>
                          Signs in as <strong>{loginUser.email ?? '—'}</strong>
                          {loginUser.isActive ? '' : ' (login turned off)'}.
                        </p>
                        {isProvider ? (
                          <p className="muted" style={{ fontSize: 12, margin: 0 }}>
                            Doctors don’t work with another doctor. Their team is whoever picks them
                            here.
                          </p>
                        ) : (
                          <div className="settings-employee-modal__grid">
                            <label>
                              <span className="label">Works with</span>
                              <select
                                className="input"
                                value={worksWithDoctorId ?? ''}
                                disabled={!canManageStaff}
                                onChange={(e) => {
                                  const v = e.target.value === '' ? null : Number(e.target.value);
                                  setWorksWithDoctorId(v);
                                  if (v == null) setWorksWithDefault(false);
                                }}
                              >
                                <option value="">No doctor</option>
                                {doctorOptions.map((doc) => (
                                  <option key={doc.id} value={doc.id}>
                                    {employeeDisplayName(doc)}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label
                              style={{ display: 'flex', alignItems: 'center', gap: 8, alignSelf: 'end' }}
                            >
                              <input
                                type="checkbox"
                                checked={worksWithDefault && worksWithDoctorId != null}
                                disabled={!canManageStaff || worksWithDoctorId == null}
                                onChange={(e) => setWorksWithDefault(e.target.checked)}
                              />
                              <span>Default for this doctor</span>
                            </label>
                          </div>
                        )}
                        {!isProvider ? (
                          <p className="muted" style={{ fontSize: 12, margin: '6px 0 0' }}>
                            Room loader emails for this doctor go out from their default, and
                            mail-order approval tasks go to them. One default per doctor: checking
                            this takes it from whoever had it. With no default, their Lead
                            Technician, then a Technician, is used.
                          </p>
                        ) : null}
                      </>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                        <p className="muted" style={{ fontSize: 12, margin: 0 }}>
                          No login yet.{' '}
                          {email.trim()
                            ? `Creating one emails ${email.trim()} a temporary password.`
                            : 'Add an email and save first.'}
                        </p>
                        {canManageLogins ? (
                          <button
                            type="button"
                            className="btn secondary"
                            disabled={creatingLogin || !email.trim() || editingId == null}
                            onClick={() => void createLogin()}
                          >
                            {creatingLogin ? 'Creating…' : 'Create login'}
                          </button>
                        ) : null}
                      </div>
                    )}
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

                  {profilePhoto ? (
                    <fieldset className="settings-employee-modal__fieldset">
                      <legend className="settings-employee-modal__legend">Photo</legend>
                      <p className="muted" style={{ fontSize: 12, margin: '0 0 8px' }}>
                        Shown in the post-appointment survey and elsewhere. JPEG, PNG, GIF, or WebP.
                        Max 5MB.
                      </p>
                      {profilePhoto}
                    </fieldset>
                  ) : null}

                  <fieldset className="settings-employee-modal__fieldset">
                    <legend className="settings-employee-modal__legend">Signature</legend>
                    <p className="muted" style={{ fontSize: 12, margin: '0 0 8px' }}>
                      Printed on written prescriptions and certificates when this person is the
                      signer.
                    </p>
                    {signatureEditor}
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
                    <button
                      type="submit"
                      className="btn"
                      disabled={saving || !canManageStaff}
                      title={canManageStaff ? undefined : 'Practice manager and above edit employees'}
                    >
                      {saving ? 'Saving…' : 'Save profile'}
                    </button>
                    {editingId != null ? (
                      <>
                        {editingRow && empActive(editingRow) && lastDayById.get(editingRow.id) ? (
                          <button
                            type="button"
                            className="btn secondary"
                            onClick={() => void cancelScheduledOffboard(editingRow.id)}
                            title={`Last day ${formatYmd(lastDayById.get(editingRow.id))}`}
                          >
                            Cancel offboarding (last day {formatYmd(lastDayById.get(editingRow.id))})
                          </button>
                        ) : editingRow && empActive(editingRow) ? (
                          <button
                            type="button"
                            className="btn secondary"
                            onClick={() => setOffboardEmp(editingRow)}
                            disabled={!canManageStaff}
                          >
                            Offboard
                          </button>
                        ) : editingRow ? (
                          <>
                            <button
                              type="button"
                              className="btn secondary"
                              onClick={() => void reactivate(editingRow)}
                            >
                              Reactivate
                            </button>
                            {(() => {
                              const gone = departed.find((d) => d.id === editingRow.id);
                              const saved = gone?.lastDay ?? '';
                              const value =
                                lastDayDraft?.id === editingRow.id
                                  ? lastDayDraft.value
                                  : saved || gone?.lastVisit || '';
                              return (
                                <span
                                  className="settings-employee-hub__last-day"
                                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}
                                >
                                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                    Last day
                                    <input
                                      type="date"
                                      aria-label="Last day"
                                      value={value}
                                      max={dayjs().format('YYYY-MM-DD')}
                                      onChange={(e) => setLastDayDraft({ id: editingRow.id, value: e.target.value })}
                                      disabled={!canManageStaff}
                                    />
                                  </label>
                                  <button
                                    type="button"
                                    className="btn secondary"
                                    disabled={!canManageStaff || lastDaySaving || !value || value === saved}
                                    onClick={() => void saveLastDay(editingRow.id, value)}
                                    title="Their goals on the VSD report stop counting after this day. Nothing else changes."
                                  >
                                    {lastDaySaving ? 'Saving…' : 'Save last day'}
                                  </button>
                                  <span className="muted" style={{ fontSize: 12 }}>
                                    {saved
                                      ? `Saved: ${formatYmd(saved)}.`
                                      : gone?.lastVisit
                                        ? `Not recorded. Goals end at their last visit, ${formatYmd(gone.lastVisit)}.`
                                        : 'Not recorded.'}
                                  </span>
                                </span>
                              );
                            })()}
                          </>
                        ) : null}
                        {rows.find((r) => r.id === editingId) ? (
                          <ViewAsButton
                            employeeId={editingId}
                            name={formatEmployeeDisplayName(rows.find((r) => r.id === editingId)!)}
                          />
                        ) : null}
                      </>
                    ) : null}
                  </div>
                </form>
              ) : (
                <>
                  {extra}
                  {section === 'access' && editingId != null ? (
                    <SettingsEmployeeAccess
                      employeeId={editingId}
                      employeeName={
                        rows
                          .filter((e) => e.id === editingId)
                          .map((e) => employeeDisplayName(e))[0]
                      }
                      onMessage={onMessage}
                      onLicenseChange={(lic) =>
                        setVetLicensed(lic.isLicensed && lic.licenseType === 'veterinarian')
                      }
                    />
                  ) : null}
                </>
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
                    <span className="label">{practiceState} license number</span>
                    <input className="input" value={licenseNumber} onChange={(e) => setLicenseNumber(e.target.value)} />
                  </label>
                  {isProvider ? (
                    <label className="settings-employee-modal__full">
                      <span className="label">Signature</span>
                      <input
                        className="input"
                        type="file"
                        accept="image/png,image/jpeg"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          const reader = new FileReader();
                          reader.onload = () => {
                            const result = typeof reader.result === 'string' ? reader.result : null;
                            setSignatureImage(result);
                          };
                          reader.readAsDataURL(file);
                        }}
                      />
                      {signatureImage ? (
                        <img
                          src={signatureImage}
                          alt="Provider signature"
                          style={{ display: 'block', maxHeight: 56, marginTop: 8 }}
                        />
                      ) : (
                        <span className="settings-muted">
                          PNG or JPEG printed on written prescriptions and certificates. After
                          they are added, you can also edit this on their Profile.
                        </span>
                      )}
                    </label>
                  ) : null}
                  <label className="settings-employee-modal__full">
                    <span className="label">Email</span>
                    <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                  </label>
                  {quoUserField}
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
                      value={practiceWide ? ALL_OFFICES : (defaultBranchId ?? '')}
                      onChange={(e) => {
                        if (e.target.value === ALL_OFFICES) {
                          setPracticeWide(true);
                          setDefaultLocationId(null);
                          return;
                        }
                        setPracticeWide(false);
                        const v = e.target.value === '' ? null : Number(e.target.value);
                        setDefaultBranchId(v != null && Number.isFinite(v) ? v : null);
                        setDefaultLocationId(null);
                      }}
                    >
                      <option value="">Select branch…</option>
                      <option value={ALL_OFFICES}>All offices (practice-wide)</option>
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
                      value={practiceWide ? '' : (defaultLocationId ?? '')}
                      disabled={practiceWide || defaultBranchId == null}
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

      {offboardEmp ? (
        <OffboardDialog
          employeeId={offboardEmp.id}
          employeeName={formatEmployeeDisplayName(offboardEmp)}
          colleagues={offboardColleagues}
          onClose={() => setOffboardEmp(null)}
          onDone={(result) => void offboardDone(result)}
        />
      ) : null}
    </div>
  );
}

type LicenseRow = { state: string; number: string };

/** The license certificates and Rx labels print: the practice-state one, else the first. */
function primaryLicenseFromRows(rows: LicenseRow[], practiceState: string): string | null {
  const filled = rows.filter((r) => r.number.trim());
  const home = filled.find((r) => r.state.trim().toUpperCase() === practiceState);
  return (home ?? filled[0])?.number.trim() || null;
}

function LicenseRowsEditor({
  rows,
  practiceState,
  onChange,
}: {
  rows: LicenseRow[];
  practiceState: string;
  onChange: (rows: LicenseRow[]) => void;
}) {
  const update = (i: number, patch: Partial<LicenseRow>) =>
    onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="settings-employee-modal__full settings-licenses">
      {rows.length === 0 ? <p className="settings-licenses__empty">None on file.</p> : null}
      {rows.map((r, i) => (
        <div key={i} className="settings-licenses__row">
          <input
            className="input settings-licenses__state"
            aria-label="State"
            placeholder="ME"
            maxLength={2}
            value={r.state}
            onChange={(e) => update(i, { state: e.target.value.toUpperCase().replace(/[^A-Z]/g, '') })}
          />
          <input
            className="input"
            aria-label="License number"
            placeholder="License number"
            value={r.number}
            onChange={(e) => update(i, { number: e.target.value })}
          />
          <button
            type="button"
            className="btn secondary btn-sm"
            aria-label="Remove this license"
            onClick={() => onChange(rows.filter((_, j) => j !== i))}
          >
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        className="btn secondary btn-sm"
        onClick={() => onChange([...rows, { state: practiceState, number: '' }])}
      >
        + Add state license
      </button>
      <p className="settings-licenses__hint">
        The {practiceState} license prints on certificates and Rx labels. One license per state. DEA numbers
        are kept in Vet Snap.
      </p>
    </div>
  );
}

import {
  fetchPrimaryProviders,
  formatDoctorSelectZoneLabel,
  type FetchVeterinariansResult,
  type Provider,
} from '../api/employee';
import {
  fetchAllEmployees,
  fetchEmployee,
  type Employee,
  type EmployeeWeeklyScheduleZone,
} from '../api/appointmentSettings';
import { resolveZoneForVeterinarianLookup } from '../api/zoneLookup';
import { DateTime } from 'luxon';
import { practiceTimeZoneOrDefault } from './practiceTimezone';

const LOOKUP_CACHE_MS = 5 * 60 * 1000;

let employeesListCache: { fetchedAt: number; rows: Employee[] } | null = null;
let providersCache: { fetchedAt: number; rows: Provider[] } | null = null;
const employeeByIdCache = new Map<number, { fetchedAt: number; employee: Employee }>();

export function clearVeterinariansZoneLookupCache(): void {
  employeesListCache = null;
  providersCache = null;
  employeeByIdCache.clear();
}

function normalizeZoneMatchKey(name: string | null | undefined): string {
  const label = formatDoctorSelectZoneLabel(name) ?? String(name ?? '').trim();
  return label.toLowerCase();
}

function scheduleZoneMatchesTarget(
  scheduleZone: EmployeeWeeklyScheduleZone,
  targetZoneId: number,
  targetZoneLabel?: string | null
): boolean {
  const rawId = scheduleZone.zoneId ?? scheduleZone.zone?.id;
  const zid = Number(rawId);
  if (Number.isFinite(zid) && zid > 0 && zid === targetZoneId) return true;

  const targetKey = normalizeZoneMatchKey(targetZoneLabel);
  if (!targetKey) return false;
  return normalizeZoneMatchKey(scheduleZone.zone?.name) === targetKey;
}

function employeeHasZoneOnScheduleDay(
  employee: Employee,
  zoneId: number,
  dayOfWeek: number,
  zoneLabel?: string | null
): boolean {
  const schedule = employee.weeklySchedules?.find((s) => s.dayOfWeek === dayOfWeek);
  const zones = schedule?.zones;
  if (!Array.isArray(zones) || zones.length === 0) return false;
  return zones.some((z) => scheduleZoneMatchesTarget(z, zoneId, zoneLabel));
}

/** Same rules as Settings → Employee Zones (assigned rows only). */
export function isEmployeeAssignedToZoneId(
  employee: Employee,
  zoneId: number,
  daysOfWeek?: readonly number[] | null,
  zoneLabel?: string | null
): boolean {
  const schedules = employee.weeklySchedules ?? [];
  if (schedules.length === 0) return false;

  if (daysOfWeek?.length) {
    const targetDays = daysOfWeek.filter((d) => Number.isFinite(d) && d >= 0 && d <= 6);
    if (targetDays.length === 0) return false;
    return targetDays.every((dow) =>
      employeeHasZoneOnScheduleDay(employee, zoneId, dow, zoneLabel)
    );
  }

  for (const schedule of schedules) {
    for (const zone of schedule.zones ?? []) {
      if (scheduleZoneMatchesTarget(zone, zoneId, zoneLabel)) return true;
    }
  }
  return false;
}

function employeeHasTransitioningZoneOnScheduleDay(
  employee: Employee,
  zoneId: number,
  dayOfWeek: number,
  zoneLabel?: string | null
): boolean {
  const schedule = employee.weeklySchedules?.find((s) => s.dayOfWeek === dayOfWeek);
  const zones = schedule?.zones;
  if (!Array.isArray(zones) || zones.length === 0) return false;
  return zones.some(
    (z) => scheduleZoneMatchesTarget(z, zoneId, zoneLabel) && z.transitioningOutOfZone === true
  );
}

/** Assigned to the zone with Transitioning Out of Zone checked (same weekday rules as assignment). */
export function isEmployeeTransitioningOutOfZoneId(
  employee: Employee,
  zoneId: number,
  daysOfWeek?: readonly number[] | null,
  zoneLabel?: string | null
): boolean {
  if (!isEmployeeAssignedToZoneId(employee, zoneId, daysOfWeek, zoneLabel)) return false;

  if (daysOfWeek?.length) {
    const targetDays = daysOfWeek.filter((d) => Number.isFinite(d) && d >= 0 && d <= 6);
    if (targetDays.length === 0) return false;
    return targetDays.every((dow) =>
      employeeHasTransitioningZoneOnScheduleDay(employee, zoneId, dow, zoneLabel)
    );
  }

  for (const schedule of employee.weeklySchedules ?? []) {
    for (const zone of schedule.zones ?? []) {
      if (scheduleZoneMatchesTarget(zone, zoneId, zoneLabel) && zone.transitioningOutOfZone === true) {
        return true;
      }
    }
  }
  return false;
}

export type DoctorClientZoneStatus =
  | { kind: 'assigned' }
  | { kind: 'not_assigned'; lastName: string | null }
  | { kind: 'transitioning_out'; lastName: string | null };

export function getEmployeeClientZoneStatus(
  employee: Employee,
  zoneId: number,
  daysOfWeek?: readonly number[] | null,
  zoneLabel?: string | null
): DoctorClientZoneStatus {
  const lastName = employee.lastName?.trim() || null;
  if (!isEmployeeAssignedToZoneId(employee, zoneId, daysOfWeek, zoneLabel)) {
    return { kind: 'not_assigned', lastName };
  }
  if (isEmployeeTransitioningOutOfZoneId(employee, zoneId, daysOfWeek, zoneLabel)) {
    return { kind: 'transitioning_out', lastName };
  }
  return { kind: 'assigned' };
}

function deriveEmployeeZoneFlagsForZoneId(
  employee: Employee,
  zoneId: number,
  daysOfWeek?: readonly number[] | null,
  zoneLabel?: string | null
): { seeingClients: boolean; acceptingNewPatients: boolean; transitioningOut: boolean } {
  const seeingClients = isEmployeeAssignedToZoneId(employee, zoneId, daysOfWeek, zoneLabel);
  let acceptingNewPatients = false;

  const schedules = employee.weeklySchedules ?? [];
  const schedulesToScan =
    daysOfWeek?.length && daysOfWeek.every((d) => Number.isFinite(d))
      ? daysOfWeek
          .map((dow) => schedules.find((s) => s.dayOfWeek === dow))
          .filter((s): s is NonNullable<typeof s> => s != null)
      : schedules;

  for (const schedule of schedulesToScan) {
    for (const zone of schedule.zones ?? []) {
      if (!scheduleZoneMatchesTarget(zone, zoneId, zoneLabel)) continue;
      if (zone.acceptingNewPatients === true) acceptingNewPatients = true;
    }
  }

  const transitioningOut =
    seeingClients &&
    isEmployeeTransitioningOutOfZoneId(employee, zoneId, daysOfWeek, zoneLabel);

  return { seeingClients, acceptingNewPatients, transitioningOut };
}

export function formatDoctorSelectSeeingClientsBadge(args: {
  zoneLabel: string | null;
  transitioningOut: boolean;
}): string {
  const zone = args.zoneLabel?.trim();
  const shortZone =
    zone != null
      ? (formatDoctorSelectZoneLabel(zone) ?? zone.split(/\s*[—–-]\s*/)[0]?.trim() ?? zone)
      : null;
  if (args.transitioningOut && shortZone) {
    return `Transitioning out of zone ${shortZone}`;
  }
  if (zone) return `Seeing clients in zone ${zone}`;
  return 'Seeing clients';
}

async function fetchAllEmployeesCached(): Promise<Employee[]> {
  const now = Date.now();
  if (employeesListCache && now - employeesListCache.fetchedAt < LOOKUP_CACHE_MS) {
    return employeesListCache.rows;
  }
  const rows = await fetchAllEmployees();
  employeesListCache = { fetchedAt: now, rows };
  return rows;
}

async function fetchPrimaryProvidersCached(): Promise<Provider[]> {
  const now = Date.now();
  if (providersCache && now - providersCache.fetchedAt < LOOKUP_CACHE_MS) {
    return providersCache.rows;
  }
  const rows = await fetchPrimaryProviders();
  providersCache = { fetchedAt: now, rows };
  return rows;
}

async function loadEmployeeById(employeeId: number): Promise<Employee | null> {
  const cached = employeeByIdCache.get(employeeId);
  const now = Date.now();
  if (cached && now - cached.fetchedAt < LOOKUP_CACHE_MS) {
    return cached.employee;
  }
  try {
    const employee = await fetchEmployee(employeeId);
    employeeByIdCache.set(employeeId, { fetchedAt: now, employee });
    return employee;
  } catch {
    return null;
  }
}

function doctorPimsIdMatches(target: string, pimsId?: string | number | null, id?: string | number | null): boolean {
  if (pimsId != null && String(pimsId).trim() === target) return true;
  if (id != null && String(id).trim() === target) return true;
  return false;
}

async function resolveEmployeeIdForDoctorPimsId(pimsId: string): Promise<number | null> {
  const target = pimsId.trim();
  if (!target) return null;

  try {
    const employees = await fetchAllEmployeesCached();
    const match = employees.find((e) => doctorPimsIdMatches(target, e.pimsId, e.id));
    if (match?.id != null && Number.isFinite(Number(match.id))) return Number(match.id);
  } catch {
    /* optional */
  }

  try {
    const providers = await fetchPrimaryProvidersCached();
    const match = providers.find((p) => doctorPimsIdMatches(target, p.pimsId, p.id));
    if (match?.id != null && Number.isFinite(Number(match.id))) return Number(match.id);
  } catch {
    /* optional */
  }

  return null;
}

async function loadEmployeeForDoctorPimsId(pimsId: string): Promise<Employee | null> {
  const employeeId = await resolveEmployeeIdForDoctorPimsId(pimsId);
  if (employeeId == null) return null;
  return loadEmployeeById(employeeId);
}

/** Settings → employee appointment type checkboxes. */
export function employeeAcceptsAppointmentType(
  employee: Employee,
  appointmentTypeId: number
): boolean {
  const target = Number(appointmentTypeId);
  if (!Number.isFinite(target) || target <= 0) return true;
  const types = employee.appointmentTypes ?? [];
  return types.some((at) => at?.id != null && Number(at.id) === target);
}

async function filterProvidersByEmployeeAppointmentType(
  providers: Provider[],
  appointmentTypeId: number | undefined
): Promise<Provider[]> {
  if (
    appointmentTypeId == null ||
    !Number.isFinite(Number(appointmentTypeId)) ||
    Number(appointmentTypeId) <= 0
  ) {
    return providers;
  }
  const typeId = Number(appointmentTypeId);
  const filtered = await Promise.all(
    providers.map(async (provider): Promise<Provider | null> => {
      const pimsId = provider.pimsId ? String(provider.pimsId) : String(provider.id);
      const employee = await loadEmployeeForDoctorPimsId(pimsId);
      if (!employee || !employeeAcceptsAppointmentType(employee, typeId)) return null;
      return provider;
    })
  );
  return filtered.filter((p): p is Provider => p != null);
}

/** Distinct `dayOfWeek` values (0=Sun … 6=Sat) covered by an inclusive date range. */
export function distinctDaysOfWeekInDateRange(
  startDate: string,
  endDate: string,
  practiceTz?: string
): number[] {
  const tz = practiceTimeZoneOrDefault(practiceTz);
  const start = DateTime.fromISO(startDate, { zone: tz }).startOf('day');
  const end = DateTime.fromISO(endDate, { zone: tz }).startOf('day');
  if (!start.isValid || !end.isValid) return [];
  const from = start <= end ? start : end;
  const to = start <= end ? end : start;
  const days = new Set<number>();
  for (let cur = from; cur <= to; cur = cur.plus({ days: 1 })) {
    days.add(cur.weekday % 7);
  }
  return [...days].sort((a, b) => a - b);
}

async function resolveLookupAddress(args: {
  address: string;
  lat?: number;
  lon?: number;
}): Promise<string> {
  const trimmed = args.address.trim();
  if (trimmed) return trimmed;

  const hasCoords =
    args.lat != null &&
    args.lon != null &&
    Number.isFinite(args.lat) &&
    Number.isFinite(args.lon);
  if (!hasCoords) return '';

  try {
    const { reverseGeocode } = await import('../api/geo');
    return (await reverseGeocode(args.lat!, args.lon!)).trim();
  } catch {
    return '';
  }
}

async function fetchProvidersByZoneId(zone: {
  id: number;
  name: string;
}): Promise<FetchVeterinariansResult> {
  const zoneLabel = formatDoctorSelectZoneLabel(zone.name);
  const providers = await fetchPrimaryProvidersCached();

  const inZone = (
    await Promise.all(
      providers.map(async (provider): Promise<Provider | null> => {
        const pimsId = provider.pimsId ? String(provider.pimsId) : String(provider.id);
        const employeeId = await resolveEmployeeIdForDoctorPimsId(pimsId);
        if (employeeId == null) return null;
        const employee = await loadEmployeeById(employeeId);
        if (!employee) return null;
        const zoneFlags = deriveEmployeeZoneFlagsForZoneId(employee, zone.id, null, zoneLabel);
        if (!zoneFlags.seeingClients) return null;
        return {
          ...provider,
          seeingClientsInClientZone: true,
          acceptingNewPatientsInClientZone: zoneFlags.acceptingNewPatients,
          transitioningOutOfClientZone: zoneFlags.transitioningOut,
        };
      })
    )
  ).filter((p): p is Provider => p != null);

  return { providers: inZone, clientZoneLabel: zoneLabel };
}

async function fetchAllProvidersForDoctorSelect(): Promise<FetchVeterinariansResult> {
  const providers = await fetchPrimaryProvidersCached();
  return { providers, clientZoneLabel: null };
}

/** Whether the doctor has Assign Zone (seeing clients) for `zoneId`. */
export async function isDoctorAssignedToClientZone(
  doctorPimsId: string,
  zoneId: number,
  opts?: {
    /** Limit to these weekdays (0=Sun … 6=Sat); omit to check any workday. */
    daysOfWeek?: readonly number[] | null;
    zoneLabel?: string | null;
  }
): Promise<boolean> {
  const status = await getDoctorClientZoneStatus(doctorPimsId, zoneId, opts);
  return status.kind === 'assigned';
}

/** Zone assignment status for routing warnings and confirm dialogs. */
export async function getDoctorClientZoneStatus(
  doctorPimsId: string,
  zoneId: number,
  opts?: {
    daysOfWeek?: readonly number[] | null;
    zoneLabel?: string | null;
  }
): Promise<DoctorClientZoneStatus> {
  const target = doctorPimsId.trim();
  if (!target || !Number.isFinite(zoneId) || zoneId <= 0) {
    return { kind: 'not_assigned', lastName: null };
  }

  const employee = await loadEmployeeForDoctorPimsId(target);
  if (!employee) return { kind: 'not_assigned', lastName: null };
  return getEmployeeClientZoneStatus(
    employee,
    zoneId,
    opts?.daysOfWeek,
    opts?.zoneLabel
  );
}

export type DoctorClientZoneIssue = {
  doctorPimsId: string;
  status: 'not_assigned' | 'transitioning_out';
  lastName: string | null;
};

export function formatDoctorZoneInlineWarning(args: {
  status: 'not_assigned' | 'transitioning_out';
  lastName: string | null;
  displayName: string;
}): string {
  if (args.status === 'transitioning_out') {
    return args.lastName
      ? `Dr. ${args.lastName} is transitioning out of this zone`
      : `${args.displayName} is transitioning out of this zone`;
  }
  return `${args.displayName} is not assigned to this zone`;
}

export function formatDoctorZoneConfirmMessage(
  issues: DoctorClientZoneIssue[],
  doctorDisplayNames?: Record<string, string>
): string {
  if (issues.length === 0) return '';

  const hasNotAssigned = issues.some((i) => i.status === 'not_assigned');
  if (hasNotAssigned) {
    return "Doctor doesn't work in this zone. Do you want to proceed?";
  }

  const transitioning = issues.filter((i) => i.status === 'transitioning_out');
  if (transitioning.length === 1) {
    const lastName = doctorLastNameForZoneConfirm(transitioning[0], doctorDisplayNames);
    if (lastName) {
      return `Dr. ${lastName} is transitioning out of this zone. Do you want to proceed?`;
    }
  }
  if (transitioning.length > 1) {
    const lastNames = transitioning
      .map((i) => doctorLastNameForZoneConfirm(i, doctorDisplayNames))
      .filter((n): n is string => Boolean(n));
    if (lastNames.length === transitioning.length) {
      const doctors = lastNames.map((n) => `Dr. ${n}`).join(', ');
      return `${doctors} are transitioning out of this zone. Do you want to proceed?`;
    }
  }

  return 'Do you want to proceed?';
}

function doctorLastNameForZoneConfirm(
  issue: DoctorClientZoneIssue,
  doctorDisplayNames?: Record<string, string>
): string | null {
  const fromEmployee = issue.lastName?.trim();
  if (fromEmployee) return fromEmployee;

  const display = doctorDisplayNames?.[issue.doctorPimsId]?.trim();
  if (!display) return null;
  const parts = display.split(/\s+/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1]! : null;
}

export type RoutingDoctorZoneCheckResult = {
  zoneLabel: string | null;
  /** Doctors that need a confirm dialog before routing. */
  outOfZoneDoctorPimsIds: string[];
  issues: DoctorClientZoneIssue[];
};

/**
 * Doctors selected for routing who are not assigned to the address zone, or are transitioning out.
 * Skips the check when the zone cannot be resolved.
 */
export async function findDoctorsNotAssignedToClientZone(args: {
  address: string;
  lat?: number;
  lon?: number;
  doctorPimsIds: string[];
  /** When already resolved for the address (e.g. routing form zone badge). */
  zoneId?: number;
  zoneLabel?: string | null;
  /** Routing search range — zone assignment is checked per weekday in this span. */
  startDate?: string;
  endDate?: string;
  practiceTz?: string;
}): Promise<RoutingDoctorZoneCheckResult> {
  const doctorPimsIds = [...new Set(args.doctorPimsIds.map((id) => id.trim()).filter(Boolean))];
  if (doctorPimsIds.length === 0) {
    return { zoneLabel: null, outOfZoneDoctorPimsIds: [], issues: [] };
  }

  let zoneId: number | null = null;
  let zoneLabel: string | null = args.zoneLabel?.trim() || null;

  if (args.zoneId != null && Number.isFinite(args.zoneId) && args.zoneId > 0) {
    zoneId = args.zoneId;
  } else {
    const lookupAddress = await resolveLookupAddress(args);
    if (!lookupAddress) {
      return { zoneLabel: null, outOfZoneDoctorPimsIds: [], issues: [] };
    }

    const resolved = await resolveZoneForVeterinarianLookup(lookupAddress);
    if (!resolved) {
      return { zoneLabel: null, outOfZoneDoctorPimsIds: [], issues: [] };
    }

    zoneId = resolved.zone.id;
    zoneLabel = formatDoctorSelectZoneLabel(resolved.zone.name);
  }
  const daysOfWeek =
    args.startDate?.trim() && args.endDate?.trim()
      ? distinctDaysOfWeekInDateRange(args.startDate, args.endDate, args.practiceTz)
      : null;
  const issues: DoctorClientZoneIssue[] = [];

  for (const pimsId of doctorPimsIds) {
    const employee = await loadEmployeeForDoctorPimsId(pimsId);
    if (!employee) {
      issues.push({ doctorPimsId: pimsId, status: 'not_assigned', lastName: null });
      continue;
    }
    const status = getEmployeeClientZoneStatus(employee, zoneId, daysOfWeek, zoneLabel);
    if (status.kind === 'not_assigned') {
      issues.push({ doctorPimsId: pimsId, status: 'not_assigned', lastName: status.lastName });
    } else if (status.kind === 'transitioning_out') {
      issues.push({ doctorPimsId: pimsId, status: 'transitioning_out', lastName: status.lastName });
    }
  }

  return {
    zoneLabel,
    outOfZoneDoctorPimsIds: issues.map((i) => i.doctorPimsId),
    issues,
  };
}

export type VeterinariansForDoctorSelectResult = FetchVeterinariansResult & {
  usedNearestZone: boolean;
};

/**
 * Load veterinarians for routing's multi-doctor picker.
 * Resolves the client's zone (or nearest zone when out of area), then filters using employee schedules.
 */
export async function fetchVeterinariansForDoctorSelect(args: {
  address: string;
  lat?: number;
  lon?: number;
}): Promise<VeterinariansForDoctorSelectResult> {
  const lookupAddress = await resolveLookupAddress(args);

  if (lookupAddress) {
    const resolved = await resolveZoneForVeterinarianLookup(lookupAddress);
    if (resolved) {
      const result = await fetchProvidersByZoneId(resolved.zone);
      return { ...result, usedNearestZone: resolved.usedNearestZone };
    }
    return { ...(await fetchAllProvidersForDoctorSelect()), usedNearestZone: false };
  }

  return { ...(await fetchAllProvidersForDoctorSelect()), usedNearestZone: false };
}

/**
 * All active providers assigned to the client zone on any workday (assign zone checked),
 * regardless of transitioning / accepting-new-patients flags. Falls back to all providers
 * when the zone cannot be resolved.
 */
export async function fetchProvidersForAsapAllDoctorSearch(args: {
  address: string;
  lat?: number;
  lon?: number;
  /** When set, only doctors with this type enabled in employee settings are included. */
  appointmentTypeId?: number;
}): Promise<VeterinariansForDoctorSelectResult> {
  const appointmentTypeId =
    args.appointmentTypeId != null &&
    Number.isFinite(Number(args.appointmentTypeId)) &&
    Number(args.appointmentTypeId) > 0
      ? Number(args.appointmentTypeId)
      : undefined;
  const lookupAddress = await resolveLookupAddress(args);

  if (lookupAddress) {
    const resolved = await resolveZoneForVeterinarianLookup(lookupAddress);
    if (resolved) {
      const zoneLabel = formatDoctorSelectZoneLabel(resolved.zone.name);
      const allProviders = await fetchPrimaryProvidersCached();
      const inZone = (
        await Promise.all(
          allProviders.map(async (provider): Promise<Provider | null> => {
            const pimsId = provider.pimsId ? String(provider.pimsId) : String(provider.id);
            const employeeId = await resolveEmployeeIdForDoctorPimsId(pimsId);
            if (employeeId == null) return null;
            const employee = await loadEmployeeById(employeeId);
            if (!employee) return null;
            if (
              appointmentTypeId != null &&
              !employeeAcceptsAppointmentType(employee, appointmentTypeId)
            ) {
              return null;
            }
            if (!isEmployeeAssignedToZoneId(employee, resolved.zone.id, null, zoneLabel)) {
              return null;
            }
            const flags = deriveEmployeeZoneFlagsForZoneId(
              employee,
              resolved.zone.id,
              null,
              zoneLabel
            );
            return {
              ...provider,
              seeingClientsInClientZone: flags.seeingClients,
              acceptingNewPatientsInClientZone: flags.acceptingNewPatients,
              transitioningOutOfClientZone: flags.transitioningOut,
            };
          })
        )
      ).filter((p): p is Provider => p != null);

      if (inZone.length > 0) {
        return {
          providers: inZone,
          clientZoneLabel: zoneLabel,
          usedNearestZone: resolved.usedNearestZone,
        };
      }
    }
  }

  const fallback = await fetchAllProvidersForDoctorSelect();
  if (!appointmentTypeId) return { ...fallback, usedNearestZone: false };
  return {
    ...fallback,
    providers: await filterProvidersByEmployeeAppointmentType(fallback.providers, appointmentTypeId),
    usedNearestZone: false,
  };
}

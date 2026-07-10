import { DateTime } from 'luxon';
import {
  isAppointmentCancelledOnPracticeCalendar,
  isPracticeCalendarBlockAppointment,
  normalizeRangeAppointment,
} from '../api/appointments';
import { fetchClientAppointmentsStaff } from '../api/pimsAppointments';
import { fetchClientByIdStaff } from '../api/clientsStaff';
import type { Appointment, Patient } from '../api/roomLoader';
import { opsPointsForAppointment } from './forwardBookingListVisibility';
import { resolveSchedulerProviderFilterFromAppointment } from './schedulerFocusAppointment';
import {
  buildAppointmentTypeCatalog,
  pointsPerPatientForType,
  resolveAppointmentType,
  type AppointmentTypeCatalog,
} from './appointmentTypeSettings';
import type { AppointmentType } from '../api/appointmentSettings';
import { practiceTimeZoneOrDefault } from './practiceTimezone';
import { appointmentHasNoPatient, patientsForAppointment } from './schedulerAddPet';

export const BOOKING_HOUSEHOLD_VISIT_LOOKBACK_MONTHS = 3;
export const BOOKING_HOUSEHOLD_VISIT_LOOKAHEAD_MONTHS = 3;

/** Embedded routing workspace: focus an existing household visit on the practice calendar. */
export const ROUTING_FOCUS_HOUSEHOLD_VISIT_EVENT = 'vayd:routing-focus-household-visit';

/** Household warning modal closed — keep calendar week, allow highlight to fade. */
export const ROUTING_HOUSEHOLD_VISIT_FOCUS_UNPIN_EVENT = 'vayd:routing-household-visit-focus-unpin';

export type RoutingFocusHouseholdVisitDetail = {
  conflict: HouseholdScheduledVisitConflict;
  /** While the routing warning modal is open, keep the visit highlighted. */
  pinHighlight?: boolean;
};

export function dispatchRoutingFocusHouseholdVisit(
  conflict: HouseholdScheduledVisitConflict,
  options?: { pinHighlight?: boolean },
): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<RoutingFocusHouseholdVisitDetail>(ROUTING_FOCUS_HOUSEHOLD_VISIT_EVENT, {
      detail: { conflict, pinHighlight: options?.pinHighlight === true },
    }),
  );
}

export function unpinRoutingHouseholdVisitHighlight(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(ROUTING_HOUSEHOLD_VISIT_FOCUS_UNPIN_EVENT));
}

export function parseRoutingFocusHouseholdVisitEvent(
  event: Event,
): RoutingFocusHouseholdVisitDetail | null {
  const detail = (event as CustomEvent<RoutingFocusHouseholdVisitDetail | HouseholdScheduledVisitConflict>)
    .detail;
  if (!detail || typeof detail !== 'object') return null;
  if ('appointmentId' in detail && detail.appointmentId != null) {
    return { conflict: detail as HouseholdScheduledVisitConflict, pinHighlight: false };
  }
  const wrapped = detail as RoutingFocusHouseholdVisitDetail;
  if (wrapped.conflict?.appointmentId != null) {
    return {
      conflict: wrapped.conflict,
      pinHighlight: wrapped.pinHighlight === true,
    };
  }
  return null;
}

export type HouseholdScheduledVisitConflict = {
  appointmentId: number;
  patientNames: string[];
  scheduledLabel: string;
  appointmentTypeLabel: string;
  isHold: boolean;
  notes: string | null;
  appointmentStartIso: string;
  practiceDateKey: string;
  primaryProviderId: string | null;
};

function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function patientDisplayName(p: Patient): string {
  return (
    pickStr(p.name) ??
    pickStr((p as { prettyName?: string }).prettyName) ??
    (p.id != null ? `Pet #${p.id}` : 'Pet')
  );
}

function appointmentTypeLabel(appt: Appointment): string {
  const at = appt.appointmentType;
  return pickStr(at?.prettyName) ?? pickStr(at?.name) ?? 'Visit';
}

function formatScheduledLabel(appt: Appointment, practiceTz: string): string {
  if (!appt.appointmentStart) return '—';
  const tz = practiceTimeZoneOrDefault(practiceTz);
  const start = DateTime.fromISO(appt.appointmentStart, { zone: 'utc' }).setZone(tz);
  if (!start.isValid) return '—';
  const datePart = start.toFormat('EEEE, MMM d, yyyy');
  const end = appt.appointmentEnd
    ? DateTime.fromISO(appt.appointmentEnd, { zone: 'utc' }).setZone(tz)
    : null;
  if (end?.isValid) {
    return `${datePart} · ${start.toFormat('h:mm a')} – ${end.toFormat('h:mm a')}`;
  }
  return `${datePart} · ${start.toFormat('h:mm a')}`;
}

function appointmentNotesForDisplay(appt: Appointment): string | null {
  const desc = appt.description?.trim() ?? '';
  const instr = appt.instructions?.trim() ?? '';
  if (desc && instr && desc !== instr) return `${desc}\n${instr}`;
  return desc || instr || null;
}

function isCountableHouseholdVisit(a: Appointment): boolean {
  if (a.isDeleted) return false;
  if (a.isActive === false) return false;
  if (a.allDay) return false;
  if (isPracticeCalendarBlockAppointment(a)) return false;
  if ((a as { isPersonalBlock?: boolean }).isPersonalBlock === true) return false;
  if (isAppointmentCancelledOnPracticeCalendar(a)) return false;
  if (!a.appointmentStart?.trim()) return false;
  return true;
}

function householdVisitSearchRangeUtc(
  rangeStart: DateTime,
  rangeEnd: DateTime,
): { startIso: string; endIso: string } | null {
  const startIso = rangeStart.toUTC().toISO();
  const endIso = rangeEnd.toUTC().toISO();
  if (!startIso || !endIso) return null;
  return { startIso, endIso };
}

/** Search window: max(today, placement − 3mo) through placement + 3mo (practice TZ). */
export function bookingHouseholdVisitSearchRange(
  placementStartIso: string,
  practiceTz: string,
): { startIso: string; endIso: string } | null {
  const tz = practiceTimeZoneOrDefault(practiceTz);
  const placement = DateTime.fromISO(placementStartIso, { zone: 'utc' }).setZone(tz);
  if (!placement.isValid) return null;
  const today = DateTime.now().setZone(tz).startOf('day');
  const rangeStart = DateTime.max(
    today,
    placement.minus({ months: BOOKING_HOUSEHOLD_VISIT_LOOKBACK_MONTHS }).startOf('day'),
  );
  const rangeEnd = placement
    .plus({ months: BOOKING_HOUSEHOLD_VISIT_LOOKAHEAD_MONTHS })
    .endOf('day');
  return householdVisitSearchRangeUtc(rangeStart, rangeEnd);
}

/** Search window for routing: max(today, searchStart − 3mo) through searchEnd + 3mo (practice TZ). */
export function routingHouseholdVisitSearchRange(
  searchStartDate: string,
  searchEndDate: string,
  practiceTz: string,
): { startIso: string; endIso: string } | null {
  const tz = practiceTimeZoneOrDefault(practiceTz);
  const start = DateTime.fromISO(searchStartDate, { zone: tz }).startOf('day');
  const end = DateTime.fromISO(searchEndDate, { zone: tz }).endOf('day');
  if (!start.isValid || !end.isValid) return null;
  const today = DateTime.now().setZone(tz).startOf('day');
  const rangeStart = DateTime.max(
    today,
    start.minus({ months: BOOKING_HOUSEHOLD_VISIT_LOOKBACK_MONTHS }).startOf('day'),
  );
  const rangeEnd = end.plus({ months: BOOKING_HOUSEHOLD_VISIT_LOOKAHEAD_MONTHS }).endOf('day');
  return householdVisitSearchRangeUtc(rangeStart, rangeEnd);
}

export function buildBookingAppointmentTypeCatalog(
  appointmentTypes: readonly AppointmentType[],
): AppointmentTypeCatalog {
  return buildAppointmentTypeCatalog([...appointmentTypes]);
}

/** True when booking a points visit or an explicit HOLD type for a linked client. */
export function shouldWarnHouseholdVisitsOnBook(args: {
  catalog: AppointmentTypeCatalog;
  appointmentTypeIds: readonly number[];
  clientId?: string | null;
}): boolean {
  const clientId = args.clientId?.trim();
  if (!clientId) return false;
  for (const raw of args.appointmentTypeIds) {
    const typeId = Number(raw);
    if (!Number.isFinite(typeId) || typeId <= 0) continue;
    const type = resolveAppointmentType(args.catalog, { typeId });
    if (type?.isHold === true) return true;
    if (pointsPerPatientForType(args.catalog, { typeId }) > 0) return true;
  }
  return false;
}

/** Resolve client for household visit warnings — form link or appointment-request intent. */
export function resolveRoutingHouseholdVisitClientId(args: {
  routingFormClientId?: string | null;
  appointmentRequestClientId?: string | null;
}): string | null {
  const formId = args.routingFormClientId?.trim();
  if (formId) return formId;
  const intentId = args.appointmentRequestClientId?.trim();
  return intentId || null;
}

/** Any routing search with a linked client should surface nearby household visits. */
export function shouldWarnHouseholdVisitsOnRoutingSearch(args: {
  clientId?: string | null;
}): boolean {
  return Boolean(args.clientId?.trim());
}

function patientMatchKeys(p: Patient): string[] {
  const keys: string[] = [];
  if (p.id != null && Number(p.id) > 0) keys.push(String(p.id));
  const row = p as Patient & Record<string, unknown>;
  const pimsId =
    pickStr(row.pimsId) ?? pickStr(row.patientPimsId) ?? pickStr(row.pims_id);
  if (pimsId) keys.push(pimsId);
  return keys;
}

function extractPatientsFromClientPayload(payload: unknown): Array<{
  id: string | number;
  pimsId?: string;
  name: string;
  isActive?: boolean;
  isDeleted?: boolean;
}> {
  if (!payload || typeof payload !== 'object') return [];
  const p = payload as Record<string, unknown>;
  const raw =
    p.patients ??
    p.patientList ??
    p.pets ??
    (Array.isArray(p.patient) ? p.patient : null);
  if (!Array.isArray(raw)) return [];
  const out: Array<{
    id: string | number;
    pimsId?: string;
    name: string;
    isActive?: boolean;
    isDeleted?: boolean;
  }> = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const o = row as Record<string, unknown>;
    const idRaw = o.id ?? o.patientId;
    if (idRaw == null || (typeof idRaw !== 'string' && typeof idRaw !== 'number')) continue;
    const joined = [pickStr(o.firstName), pickStr(o.lastName)].filter(Boolean).join(' ').trim();
    const name = pickStr(o.name) ?? (joined || 'Patient');
    const pimsId =
      pickStr(o.pimsId) ?? pickStr(o.pims_id) ?? pickStr(o.patientPimsId) ?? undefined;
    out.push({
      id: idRaw,
      pimsId,
      name,
      isActive:
        o.isActive === true || o.isActive === 1
          ? true
          : o.isActive === false
            ? false
            : undefined,
      isDeleted:
        o.isDeleted === true || o.isDeleted === 1
          ? true
          : o.isDeleted === false
            ? false
            : undefined,
    });
  }
  return out;
}

async function resolveHouseholdPatientIds(args: {
  clientId: string;
  householdPatientIds?: readonly string[];
  bookingPatientIds?: readonly string[];
}): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const id of args.householdPatientIds ?? []) {
    const s = String(id).trim();
    if (s) ids.add(s);
  }
  if (ids.size === 0) {
    for (const id of args.bookingPatientIds ?? []) {
      const s = String(id).trim();
      if (s) ids.add(s);
    }
  }
  if (ids.size > 0) return ids;

  try {
    const payload = await fetchClientByIdStaff(args.clientId);
    for (const pet of extractPatientsFromClientPayload(payload)) {
      if (pet.isDeleted === true || pet.isActive === false) continue;
      ids.add(String(pet.id));
      if (pet.pimsId) ids.add(pet.pimsId);
    }
  } catch {
    /* fall back to booking patients only */
    for (const id of args.bookingPatientIds ?? []) {
      const s = String(id).trim();
      if (s) ids.add(s);
    }
  }
  return ids;
}

export async function findHouseholdScheduledVisitConflicts(args: {
  practiceId: number;
  clientId: string;
  practiceTz: string;
  catalog: AppointmentTypeCatalog;
  /** Single placement anchor (book flow). */
  placementStartIso?: string;
  /** Routing search window (`YYYY-MM-DD` in practice TZ). */
  searchStartDate?: string;
  searchEndDate?: string;
  householdPatientIds?: readonly string[];
  bookingPatientIds?: readonly string[];
  excludeAppointmentIds?: readonly number[];
}): Promise<HouseholdScheduledVisitConflict[]> {
  const clientId = args.clientId.trim();
  if (!clientId) return [];

  const isRoutingSearch = Boolean(
    args.searchStartDate?.trim() && args.searchEndDate?.trim(),
  );

  const range =
    isRoutingSearch
      ? routingHouseholdVisitSearchRange(
          args.searchStartDate!.trim(),
          args.searchEndDate!.trim(),
          args.practiceTz,
        )
      : args.placementStartIso?.trim()
        ? bookingHouseholdVisitSearchRange(args.placementStartIso.trim(), args.practiceTz)
        : null;
  if (!range) return [];

  const householdIds = await resolveHouseholdPatientIds({
    clientId,
    householdPatientIds: isRoutingSearch ? undefined : args.householdPatientIds,
    bookingPatientIds: args.bookingPatientIds,
  });
  const requirePatientMatch =
    !isRoutingSearch &&
    ((args.bookingPatientIds?.length ?? 0) > 0 ||
      (args.householdPatientIds?.length ?? 0) > 0);

  const exclude = new Set(
    (args.excludeAppointmentIds ?? [])
      .map((id) => Number(id))
      .filter((id) => Number.isFinite(id) && id > 0),
  );

  const rows = (
    await fetchClientAppointmentsStaff(clientId, {
      practiceId: args.practiceId,
      start: range.startIso,
      end: range.endIso,
      activePatientsOnly: false,
    })
  ).map(normalizeRangeAppointment);

  const conflicts: HouseholdScheduledVisitConflict[] = [];
  const seen = new Set<number>();

  for (const appt of rows) {
    if (!isCountableHouseholdVisit(appt)) continue;
    const apptId = Number(appt.id);
    if (!Number.isFinite(apptId) || apptId <= 0) continue;
    if (exclude.has(apptId) || seen.has(apptId)) continue;

    const apptPatients = patientsForAppointment(appt);
    const matchedPatients = requirePatientMatch
      ? apptPatients.filter((p) => patientMatchKeys(p).some((key) => householdIds.has(key)))
      : apptPatients;
    if (
      requirePatientMatch &&
      matchedPatients.length === 0 &&
      !appointmentHasNoPatient(appt)
    ) {
      continue;
    }

    seen.add(apptId);
    const points = opsPointsForAppointment(appt, args.catalog);
    const practiceDateKey =
      DateTime.fromISO(appt.appointmentStart!, { zone: 'utc' })
        .setZone(practiceTimeZoneOrDefault(args.practiceTz))
        .toISODate() ?? '';
    conflicts.push({
      appointmentId: apptId,
      patientNames:
        matchedPatients.length > 0
          ? matchedPatients.map(patientDisplayName)
          : apptPatients.length > 0
            ? apptPatients.map(patientDisplayName)
            : ['Household'],
      scheduledLabel: formatScheduledLabel(appt, args.practiceTz),
      appointmentTypeLabel: appointmentTypeLabel(appt),
      isHold: points <= 0,
      notes: appointmentNotesForDisplay(appt),
      appointmentStartIso: appt.appointmentStart!,
      practiceDateKey,
      primaryProviderId: resolveSchedulerProviderFilterFromAppointment(appt, []) || null,
    });
  }

  conflicts.sort((a, b) => a.appointmentStartIso.localeCompare(b.appointmentStartIso));
  return conflicts;
}

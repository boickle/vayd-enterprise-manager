import { DateTime } from 'luxon';
import type { AppointmentType } from '../api/appointmentSettings';
import { clientIdFromAppointment, patientIdFromAppointment } from '../api/pimsAppointments';
import type { Appointment, Client, Patient } from '../api/roomLoader';
import type {
  CreateForwardBookingPayload,
  ForwardBookingEntry,
  ForwardBookingIntervalUnit,
} from '../api/forwardBooking';
import { practiceTimeZoneOrDefault } from './practiceTimezone';

export type { ForwardBookingIntervalUnit };

export const FORWARD_BOOKING_AMOUNT_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

export const FORWARD_BOOKING_UNIT_OPTIONS: { value: ForwardBookingIntervalUnit; label: string }[] = [
  { value: 'days', label: 'Days' },
  { value: 'weeks', label: 'Weeks' },
  { value: 'months', label: 'Months' },
];

export type ForwardBookingInterval = {
  amount: number;
  unit: ForwardBookingIntervalUnit;
};

function normalizeIntervalUnit(unit: unknown): ForwardBookingIntervalUnit | null {
  const u = String(unit ?? '')
    .trim()
    .toLowerCase();
  if (u === 'days' || u === 'day') return 'days';
  if (u === 'weeks' || u === 'week') return 'weeks';
  if (u === 'months' || u === 'month') return 'months';
  return null;
}

/** Calendar due date from source visit + staff interval (same rule the API should use). */
/** Infer source visit time from target due date minus the forward-book interval. */
export function forwardBookingSourceDateIsoFromTarget(args: {
  targetDueDateIso: string;
  intervalAmount: number;
  intervalUnit: ForwardBookingIntervalUnit;
  practiceTz: string;
}): string | null {
  const { targetDueDateIso, intervalAmount, intervalUnit, practiceTz } = args;
  if (!Number.isFinite(intervalAmount) || intervalAmount <= 0) return null;
  const tz = practiceTimeZoneOrDefault(practiceTz);
  const target = DateTime.fromISO(targetDueDateIso, { zone: 'utc' }).setZone(tz);
  if (!target.isValid) return null;
  const source =
    intervalUnit === 'days'
      ? target.minus({ days: intervalAmount })
      : intervalUnit === 'weeks'
        ? target.minus({ weeks: intervalAmount })
        : target.minus({ months: intervalAmount });
  return source.toUTC().toISO();
}

export function resolveForwardBookingSourceStartIso(
  entry: Pick<
    ForwardBookingEntry,
    'sourceAppointmentStart' | 'targetDueDate' | 'intervalAmount' | 'intervalUnit' | 'monthsOut'
  >,
  practiceTz: string
): string | null {
  const fromApi = entry.sourceAppointmentStart?.trim();
  if (fromApi) return fromApi;
  const interval = resolveForwardBookingIntervalFromEntry(entry);
  const target = entry.targetDueDate?.trim();
  if (!interval || !target) return null;
  return forwardBookingSourceDateIsoFromTarget({
    targetDueDateIso: target,
    intervalAmount: interval.amount,
    intervalUnit: interval.unit,
    practiceTz,
  });
}

export function forwardBookingTargetDueDateIso(
  amount: number,
  unit: ForwardBookingIntervalUnit,
  sourceDateIso: string
): string | null {
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const source = DateTime.fromISO(sourceDateIso);
  if (!source.isValid) return null;
  const target =
    unit === 'days'
      ? source.plus({ days: amount })
      : unit === 'weeks'
        ? source.plus({ weeks: amount })
        : source.plus({ months: amount });
  return target.toUTC().toISO();
}

/** Target due date from API or source visit + interval when the API omits it. */
export function resolveForwardBookingTargetDueDateIso(
  entry: Pick<
    ForwardBookingEntry,
    | 'targetDueDate'
    | 'sourceAppointmentStart'
    | 'intervalAmount'
    | 'intervalUnit'
    | 'monthsOut'
  >,
  practiceTz: string
): string | null {
  const fromApi = entry.targetDueDate?.trim();
  if (fromApi) return fromApi;
  const interval = resolveForwardBookingIntervalFromEntry(entry);
  const source = entry.sourceAppointmentStart?.trim();
  if (!interval || !source) return null;
  return forwardBookingTargetDueDateIso(interval.amount, interval.unit, source);
}

export function forwardBookingTargetDueDayMillis(
  entry: Pick<
    ForwardBookingEntry,
    | 'targetDueDate'
    | 'sourceAppointmentStart'
    | 'intervalAmount'
    | 'intervalUnit'
    | 'monthsOut'
  >,
  practiceTz: string
): number {
  const iso = resolveForwardBookingTargetDueDateIso(entry, practiceTz);
  if (!iso) return Number.MAX_SAFE_INTEGER;
  const tz = practiceTimeZoneOrDefault(practiceTz);
  const day = DateTime.fromISO(iso, { zone: 'utc' }).setZone(tz).startOf('day');
  return day.isValid ? day.toMillis() : Number.MAX_SAFE_INTEGER;
}

export const FORWARD_BOOKING_HIGH_PRIORITY_WITHIN_WEEKS = 4;

/** True when the target due date is today or within the next four weeks (practice TZ). */
export function forwardBookingIsHighPriority(
  entry: Pick<
    ForwardBookingEntry,
    | 'targetDueDate'
    | 'sourceAppointmentStart'
    | 'intervalAmount'
    | 'intervalUnit'
    | 'monthsOut'
  >,
  practiceTz: string,
  now: DateTime = DateTime.now()
): boolean {
  const iso = resolveForwardBookingTargetDueDateIso(entry, practiceTz);
  if (!iso) return false;
  const tz = practiceTimeZoneOrDefault(practiceTz);
  const targetDay = DateTime.fromISO(iso, { zone: 'utc' }).setZone(tz).startOf('day');
  if (!targetDay.isValid) return false;
  const today = now.setZone(tz).startOf('day');
  const cutoff = today.plus({ weeks: FORWARD_BOOKING_HIGH_PRIORITY_WITHIN_WEEKS });
  return targetDay <= cutoff;
}

export function forwardBookingClientHouseholdKey(
  entry: Pick<ForwardBookingEntry, 'clientId' | 'client'>
): string {
  const id = entry.clientId ?? entry.client?.id;
  if (id != null && Number.isFinite(Number(id))) return `id:${Number(id)}`;
  const first = String(entry.client?.firstName ?? '').trim();
  const last = String(entry.client?.lastName ?? '').trim();
  const name = [first, last].filter(Boolean).join(' ').trim();
  return name ? `name:${name.toLowerCase()}` : 'unknown';
}

export function buildForwardBookingHouseholdMinTargetDueMap(
  entries: Iterable<ForwardBookingEntry>,
  practiceTz: string
): Map<string, number> {
  const map = new Map<string, number>();
  for (const entry of entries) {
    const key = forwardBookingClientHouseholdKey(entry);
    const day = forwardBookingTargetDueDayMillis(entry, practiceTz);
    const prev = map.get(key);
    if (prev == null || day < prev) map.set(key, day);
  }
  return map;
}

function forwardBookingPatientSortName(entry: ForwardBookingEntry): string {
  const name = String(entry.patient?.name ?? '').trim();
  if (name) return name;
  if (entry.patientId != null) return `Patient #${entry.patientId}`;
  return '';
}

/** Household order: soonest target date in household, then client name; pets by target date. */
export function compareForwardBookingListEntries(
  a: ForwardBookingEntry,
  b: ForwardBookingEntry,
  practiceTz: string,
  clientName: (entry: ForwardBookingEntry) => string,
  householdMinTargetDue: Map<string, number>
): number {
  const keyA = forwardBookingClientHouseholdKey(a);
  const keyB = forwardBookingClientHouseholdKey(b);

  if (keyA === keyB) {
    const ta = forwardBookingTargetDueDayMillis(a, practiceTz);
    const tb = forwardBookingTargetDueDayMillis(b, practiceTz);
    if (ta !== tb) return ta - tb;
    return forwardBookingPatientSortName(a).localeCompare(
      forwardBookingPatientSortName(b),
      undefined,
      { sensitivity: 'base' }
    );
  }

  const minA = householdMinTargetDue.get(keyA) ?? forwardBookingTargetDueDayMillis(a, practiceTz);
  const minB = householdMinTargetDue.get(keyB) ?? forwardBookingTargetDueDayMillis(b, practiceTz);
  if (minA !== minB) return minA - minB;

  const nameCmp = clientName(a).localeCompare(clientName(b), undefined, { sensitivity: 'base' });
  if (nameCmp !== 0) return nameCmp;

  return keyA.localeCompare(keyB);
}

export function sortForwardBookingListEntries(
  entries: ForwardBookingEntry[],
  practiceTz: string,
  clientName: (entry: ForwardBookingEntry) => string
): ForwardBookingEntry[] {
  const householdMin = buildForwardBookingHouseholdMinTargetDueMap(entries, practiceTz);
  return [...entries].sort((a, b) =>
    compareForwardBookingListEntries(a, b, practiceTz, clientName, householdMin)
  );
}

export type ForwardBookingHouseholdGroup = {
  key: string;
  entries: ForwardBookingEntry[];
};

/** Preserves entry order — call after household sort so pets stay under their client. */
export function groupForwardBookingListByHousehold(
  entries: ForwardBookingEntry[]
): ForwardBookingHouseholdGroup[] {
  const groups: ForwardBookingHouseholdGroup[] = [];
  for (const entry of entries) {
    const key = forwardBookingClientHouseholdKey(entry);
    const tail = groups[groups.length - 1];
    if (tail?.key === key) tail.entries.push(entry);
    else groups.push({ key, entries: [entry] });
  }
  return groups;
}

/** Resolve interval from API row (new fields first, legacy integer monthsOut). */
export function resolveForwardBookingIntervalFromEntry(
  entry: Pick<ForwardBookingEntry, 'intervalAmount' | 'intervalUnit' | 'monthsOut'>
): ForwardBookingInterval | null {
  const unit = normalizeIntervalUnit(entry.intervalUnit);
  const amount = entry.intervalAmount;
  if (amount != null && Number.isFinite(amount) && amount > 0 && unit) {
    return { amount, unit };
  }
  const mo = entry.monthsOut;
  if (mo != null && Number.isFinite(mo) && mo > 0) {
    const rounded = Math.round(mo);
    if (rounded > 0) return { amount: rounded, unit: 'months' };
  }
  return null;
}

/**
 * Interval length in days for the ±1/5 routing search window.
 * Weeks use 7d; months use 30d (e.g. 1 mo → buffer round(30/5) = 6 days).
 */
export function forwardBookingIntervalSpanDays(
  amount: number,
  unit: ForwardBookingIntervalUnit
): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  if (unit === 'days') return amount;
  if (unit === 'weeks') return amount * 7;
  return amount * 30;
}

/**
 * Routing slot search range: target due date ± round(spanDays / 5).
 * Example: 2 weeks (14d) → ±3d around due date; 1 month (30d) → ±6d.
 */
export function forwardBookingRoutingSearchDateRange(args: {
  intervalAmount: number;
  intervalUnit: ForwardBookingIntervalUnit;
  targetDueDateIso?: string | null;
  practiceTz: string;
}): { startDate: string; endDate: string } | null {
  const { intervalAmount, intervalUnit, targetDueDateIso, practiceTz } = args;
  const spanDays = forwardBookingIntervalSpanDays(intervalAmount, intervalUnit);
  if (spanDays <= 0) return null;

  const bufferDays = Math.max(1, Math.round(spanDays / 5));
  const tz = practiceTimeZoneOrDefault(practiceTz);

  let target: DateTime;
  if (targetDueDateIso?.trim()) {
    target = DateTime.fromISO(targetDueDateIso, { zone: 'utc' }).setZone(tz);
  } else {
    target = DateTime.now().setZone(tz);
    target =
      intervalUnit === 'days'
        ? target.plus({ days: intervalAmount })
        : intervalUnit === 'weeks'
          ? target.plus({ weeks: intervalAmount })
          : target.plus({ months: intervalAmount });
  }
  if (!target.isValid) return null;

  return {
    startDate: target.minus({ days: bufferDays }).toFormat('yyyy-MM-dd'),
    endDate: target.plus({ days: bufferDays }).toFormat('yyyy-MM-dd'),
  };
}

export function formatForwardBookingIntervalLabel(opts: {
  intervalAmount?: number | null;
  intervalUnit?: ForwardBookingIntervalUnit | string | null;
  /** Legacy rows only — not used when interval fields are present. */
  monthsOut?: number | null;
}): string {
  const resolved = resolveForwardBookingIntervalFromEntry({
    intervalAmount: opts.intervalAmount,
    intervalUnit: opts.intervalUnit,
    monthsOut: opts.monthsOut,
  });
  if (resolved) {
    const { amount, unit } = resolved;
    const unitLabel =
      unit === 'days' ? (amount === 1 ? 'day' : 'days')
      : unit === 'weeks' ? (amount === 1 ? 'week' : 'weeks')
      : amount === 1 ? 'month' : 'months';
    return `${amount} ${unitLabel} out`;
  }
  return '—';
}

function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function patientsForAppointment(a: Appointment): Patient[] {
  const multi = (a as { patients?: Patient[] }).patients;
  if (Array.isArray(multi) && multi.length > 0) return multi;
  return a.patient ? [a.patient] : [];
}

type ForwardBookingTypeCatalogRow = Pick<
  AppointmentType,
  'id' | 'name' | 'prettyName' | 'isDeleted' | 'isActive'
>;

function appointmentTypeNameCandidates(appt: Appointment): string[] {
  const at = appt.appointmentType;
  return [pickStr(at?.name), pickStr(at?.prettyName)].filter(Boolean) as string[];
}

/** Map source visit type to a practice catalog id; omit when unknown or archived. */
export function resolveForwardBookingAppointmentTypeId(
  appt: Appointment,
  catalog?: readonly ForwardBookingTypeCatalogRow[]
): number | undefined {
  const rawId = appt.appointmentType?.id;
  const typeId = rawId != null && Number.isFinite(Number(rawId)) ? Number(rawId) : undefined;
  if (!catalog?.length) return typeId;

  const active = catalog.filter((t) => t.isDeleted !== true && t.isActive !== false);
  if (typeId != null) {
    const byId = active.find((t) => t.id === typeId);
    if (byId) return byId.id;
  }

  const names = appointmentTypeNameCandidates(appt).map((n) => n.toLowerCase());
  for (const name of names) {
    const match = active.find((t) => {
      const n = pickStr(t.name)?.toLowerCase();
      const p = pickStr(t.prettyName)?.toLowerCase();
      return n === name || p === name;
    });
    if (match) return match.id;
  }
  return undefined;
}

/** Build POST /forward-bookings body from the visit being ended. */
export function buildCreateForwardBookingPayloadFromAppointment(
  appt: Appointment,
  interval: ForwardBookingInterval,
  practiceId: number,
  opts?: {
    bookingNotes?: string | null;
    appointmentTypes?: readonly ForwardBookingTypeCatalogRow[];
    /** Fallback when the appointment payload omits nested client/patient. */
    patientId?: number;
    clientId?: number;
  }
): CreateForwardBookingPayload | null {
  if (!appt?.id || typeof appt.id !== 'number') return null;

  const patientIdRaw =
    opts?.patientId != null && Number.isFinite(Number(opts.patientId))
      ? String(Number(opts.patientId))
      : (patientsForAppointment(appt)[0]?.id ??
        patientIdFromAppointment(appt) ??
        null);
  const clientIdRaw =
    opts?.clientId != null && Number.isFinite(Number(opts.clientId))
      ? String(Number(opts.clientId))
      : ((appt.client as Client | undefined)?.id ??
        clientIdFromAppointment(appt) ??
        null);

  const patientId = patientIdRaw != null ? Number(patientIdRaw) : NaN;
  const clientId = clientIdRaw != null ? Number(clientIdRaw) : NaN;
  if (!Number.isFinite(patientId) || !Number.isFinite(clientId)) return null;

  const start = DateTime.fromISO(appt.appointmentStart);
  const end = DateTime.fromISO(appt.appointmentEnd);
  const minutes =
    start.isValid && end.isValid ? Math.max(15, Math.round(end.diff(start, 'minutes').minutes)) : 45;

  const appointmentTypeId = resolveForwardBookingAppointmentTypeId(appt, opts?.appointmentTypes);

  const pp = appt.primaryProvider;
  const primaryProviderId =
    pp?.id != null && Number.isFinite(Number(pp.id)) ? Number(pp.id) : undefined;

  const bookingNotesRaw = opts?.bookingNotes?.trim();
  const bookingNotes = bookingNotesRaw ? bookingNotesRaw : null;

  return {
    practiceId,
    sourceAppointmentId: appt.id,
    clientId,
    patientId,
    intervalAmount: interval.amount,
    intervalUnit: interval.unit,
    ...(appointmentTypeId != null ? { appointmentTypeId } : {}),
    ...(primaryProviderId != null ? { primaryProviderId } : {}),
    description: appt.description ?? null,
    instructions: appt.instructions ?? null,
    serviceMinutes: minutes,
    ...(bookingNotes != null ? { bookingNotes } : {}),
  };
}

/** POST /forward-bookings when staff adds a follow-up without linking a source visit. */
export function buildCreateForwardBookingPayloadFromPatient(
  patientId: number,
  clientId: number,
  interval: ForwardBookingInterval,
  practiceId: number,
  opts?: {
    bookingNotes?: string | null;
  }
): CreateForwardBookingPayload | null {
  if (!Number.isFinite(patientId) || patientId <= 0) return null;
  if (!Number.isFinite(clientId) || clientId <= 0) return null;

  const bookingNotesRaw = opts?.bookingNotes?.trim();
  const bookingNotes = bookingNotesRaw ? bookingNotesRaw : null;

  return {
    practiceId,
    clientId,
    patientId,
    intervalAmount: interval.amount,
    intervalUnit: interval.unit,
    ...(bookingNotes != null ? { bookingNotes } : {}),
  };
}

// src/api/appointments.ts
import { DateTime } from 'luxon';
import { http } from './http';
import type { Appointment } from './roomLoader';
import { mergeForwardBookingDispositionOntoAppointment } from '../utils/forwardBookingDisposition';
import { practiceTimeZoneOrDefault } from '../utils/practiceTimezone';

export type RangeAppointment = Appointment;

/** Normalized confirm/status strings that mean “do not show on practice calendar” (PIMS + presets). */
const PRACTICE_CALENDAR_CANCELLED_STATUSES = new Set([
  'canceled appointment',
  'cancelled appointment',
  'canceled',
  'cancelled',
]);

/** PATCH cancel + analytics — server/PIMS confirm label for removed visits. */
export const PRACTICE_CALENDAR_CANCEL_CONFIRM_STATUS = 'Canceled Appointment';

/**
 * True when confirm or appointment status marks the visit cancelled (same labels as cancellations analytics).
 * Used by Scheduler and related booking overlap logic.
 */
export function isAppointmentCancelledOnPracticeCalendar(
  a: Pick<Appointment, 'confirmStatusName' | 'statusName'> & Record<string, unknown>
): boolean {
  if (truthyApiFlag(a.cancellationFlag)) return true;
  if (truthyApiFlag(a.isCancelled) || truthyApiFlag(a.cancelled) || truthyApiFlag(a.isCanceled)) {
    return true;
  }
  const norm = (v: string | null | undefined) => {
    if (typeof v !== 'string') return '';
    const t = v.trim().toLowerCase().replace(/\s+/g, ' ');
    return t;
  };
  const confirm = norm(a.confirmStatusName);
  const status = norm(a.statusName);
  return (
    (confirm !== '' && PRACTICE_CALENDAR_CANCELLED_STATUSES.has(confirm)) ||
    (status !== '' && PRACTICE_CALENDAR_CANCELLED_STATUSES.has(status))
  );
}

/**
 * GET /appointments/range — appointments overlapping [start, end] (ISO 8601, UTC).
 * Optional primaryProviderId scopes to one doctor; omit for entire practice.
 */
export async function fetchAppointmentsRange(params: {
  practiceId: number | string;
  start: string;
  end: string;
  primaryProviderId?: number | string;
}): Promise<Appointment[]> {
  const query: Record<string, string> = {
    practiceId: String(params.practiceId),
    start: params.start,
    end: params.end,
  };
  if (params.primaryProviderId != null && String(params.primaryProviderId).trim() !== '') {
    query.primaryProviderId = String(params.primaryProviderId);
  }
  const { data } = await http.get('/appointments/range', { params: query });
  const rows: Appointment[] = Array.isArray(data) ? data : (data?.items ?? []);
  return rows.map(normalizeRangeAppointment);
}

/**
 * GET /appointments/:id — full appointment row (for realtime incremental calendar updates).
 * Optional practiceId if the API requires scoping.
 */
export async function fetchAppointmentById(
  id: number | string,
  opts?: { practiceId?: number | string }
): Promise<Appointment | null> {
  try {
    const params =
      opts?.practiceId != null ? { practiceId: String(opts.practiceId) } : undefined;
    const { data } = await http.get<Appointment>(`/appointments/${encodeURIComponent(String(id))}`, {
      params,
    });
    return data ? normalizeRangeAppointment(data) : null;
  } catch {
    return null;
  }
}

/** POST /appointments — Vayd-native appointment (pimsType VAYD on server) */
export type CreateAppointmentPayload = {
  practiceId: number;
  primaryProviderId: number;
  additionalEmployeeIds?: number[];
  /** Optional when the appointment type allows a client (`allowClient`); omit otherwise. */
  clientId?: number;
  /** Omitted when the client has no patients on file. */
  patientId?: number;
  /** Optional routing stop address (e.g. address-only Get Best Route). */
  alternateAddressText?: string | null;
  appointmentTypeId: number;
  appointmentStart: string;
  appointmentEnd: string;
  description?: string;
  instructions?: string;
  equipment?: string;
  medications?: string;
  treatmentId?: number;
  allDay?: boolean;
  /** When true, skip manual booking permission checks (routing commit). */
  bookedViaRouting?: boolean;
  /** Forward booking tracking token — server marks the forward booking complete when present. */
  forwardBookingTrackingToken?: string;
};

export type UpdateAppointmentPayload = Record<string, unknown> & {
  bookedViaRouting?: boolean;
};

export async function createAppointment(body: CreateAppointmentPayload): Promise<Appointment> {
  const { data } = await http.post<Appointment>('/appointments', body);
  return data;
}

/** PATCH /appointments/:id — partial update (field names match Appointment / server contract). */
export async function patchAppointment(
  id: number | string,
  body: Record<string, unknown>,
  opts?: { practiceId?: number | string }
): Promise<Appointment> {
  const params =
    opts?.practiceId != null ? { practiceId: String(opts.practiceId) } : undefined;
  const { data } = await http.patch<Appointment>(
    `/appointments/${encodeURIComponent(String(id))}`,
    body,
    { params }
  );
  return data;
}

/** Mark visit cancelled (practice calendar / PIMS sync). Reason optional for no-location visits. */
export type CancelAppointmentPatch = {
  cancellationFlag: true;
  cancellationReason?: string | null;
};

export function truthyApiFlag(v: unknown): boolean {
  if (v === true || v === 1) return true;
  if (typeof v === 'string') {
    const t = v.trim().toLowerCase();
    return t === 'true' || t === '1' || t === 'yes';
  }
  return false;
}

/** PIMS/eVet visit complete — distinct from Scout-recorded actual start/end times. */
export function appointmentIsPimsComplete(appt: Pick<Appointment, 'isComplete'>): boolean {
  return appt.isComplete === true;
}

function alternateAddressTextFromObject(alt: unknown): string | null {
  if (typeof alt === 'string' && alt.trim()) return alt.trim();
  if (!alt || typeof alt !== 'object') return null;
  const o = alt as Record<string, unknown>;
  for (const key of ['addressText', 'text', 'address', 'formatted', 'fullAddress', 'line1']) {
    const v = o[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

/** Routing alternate stop — nested `alternateAddress` or flat `alternateAddressText` from range/doctor-day APIs. */
export function appointmentAlternateAddressText(
  a: Pick<Appointment, 'alternateAddress'> & Record<string, unknown>
): string | null {
  const nested = alternateAddressTextFromObject(a.alternateAddress);
  if (nested) return nested;
  for (const key of ['alternateAddressText', 'alternate_address_text', 'routingAlternateAddress']) {
    const v = a[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  const meta = a.newApptMeta;
  if (meta && typeof meta === 'object') {
    const addr = (meta as { address?: unknown }).address;
    if (typeof addr === 'string' && addr.trim()) return addr.trim();
  }
  return null;
}

export function appointmentHasAlternateLocation(
  a: Pick<Appointment, 'alternateAddress'> & Record<string, unknown>
): boolean {
  if (truthyApiFlag(a.isAlternateStop)) return true;
  return appointmentAlternateAddressText(a) != null;
}

/** Strip alternate routing fields for calendar display after a home-address link. */
export function appointmentWithoutAlternateRoutingAddress(appt: Appointment): Appointment {
  const next = { ...appt } as Appointment & Record<string, unknown>;
  next.alternateAddress = null;
  next.alternateAddressText = null;
  next.isAlternateStop = false;
  const meta = next.newApptMeta;
  if (meta && typeof meta === 'object') {
    const copy = { ...(meta as Record<string, unknown>) };
    delete copy.address;
    next.newApptMeta = copy;
  }
  return next;
}

/** Coerce range/realtime rows so calendar UI always sees nested + flat alternate fields when present. */
export function normalizeRangeAppointment(row: Appointment): Appointment {
  const raw = row as Appointment & Record<string, unknown>;
  const text = appointmentAlternateAddressText(raw);
  const hasAlt = appointmentHasAlternateLocation(raw);
  let out: Appointment = { ...row, isComplete: row.isComplete === true };
  if (text || hasAlt) {
    const next = { ...row } as Appointment & Record<string, unknown>;
    if (text) {
      next.alternateAddress = { addressText: text };
      next.alternateAddressText = text;
    }
    if (hasAlt && !truthyApiFlag(next.isAlternateStop)) {
      next.isAlternateStop = true;
    }
    out = next;
  }
  return mergeForwardBookingDispositionOntoAppointment(out);
}

export function isAppointmentNoLocation(
  a: Pick<Appointment, 'client'> & Record<string, unknown>
): boolean {
  if (Boolean(a.isNoLocation ?? a.noLocation ?? a.unroutable) || a.routingAvailable === false) {
    return true;
  }
  const client = a.client;
  const lat =
    typeof a.lat === 'number' ? a.lat : typeof client?.lat === 'number' ? client.lat : null;
  const lon =
    typeof a.lon === 'number' ? a.lon : typeof client?.lon === 'number' ? client.lon : null;
  if (lat == null || lon == null) return true;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return true;
  if (Math.abs(lat) < 1e-6 && Math.abs(lon) < 1e-6) return true;
  return false;
}

/**
 * Personal / flex blocks on the practice calendar (e.g. "Back to office at 4pm").
 * Not the same as doctor-day `noloc:*` routing keys on client visits.
 */
export function isPracticeCalendarBlockAppointment(a: Appointment): boolean {
  const o = a as Record<string, unknown>;
  const typeRoot = typeof o.type === 'string' ? o.type : undefined;
  const isB = truthyApiFlag(o.isBlock);
  const isPB = truthyApiFlag(o.isPersonalBlock);
  if (
    isBlockEntry({
      type: typeRoot,
      isBlock: isB ? true : undefined,
      isPersonalBlock: isPB ? true : undefined,
    })
  ) {
    return true;
  }
  if (isFlexBlockItem(a as { blockLabel?: string; title?: string })) {
    return true;
  }
  const at = a.appointmentType;
  const typeBlob = `${at?.prettyName ?? ''} ${at?.name ?? ''}`.trim().toLowerCase();
  if (
    typeBlob === 'block' ||
    typeBlob.includes('personal block') ||
    typeBlob.includes('flex block') ||
    /^block[\s/]/i.test(typeBlob) ||
    /\bblock\s*\(/.test(typeBlob)
  ) {
    return true;
  }
  const apptPims = (a as { pimsType?: string | null }).pimsType?.trim().toUpperCase();
  if (apptPims === 'BLOCK' || apptPims === 'PERSONAL_BLOCK' || apptPims === 'PERSONALBLOCK') {
    return true;
  }
  const atPims = (at as { pimsType?: string | null } | undefined)?.pimsType?.trim().toUpperCase();
  if (atPims === 'BLOCK' || atPims === 'PERSONAL_BLOCK') {
    return true;
  }
  return false;
}

/** Scheduler Remove: personal/flex blocks and no-location rows use confirm-only (no reason). */
export function appointmentRemoveRequiresCancellationReason(
  a: Appointment & Record<string, unknown>
): boolean {
  if (isPracticeCalendarBlockAppointment(a)) return false;
  if (isAppointmentNoLocation(a)) return false;
  return true;
}

/** Merge cancel fields onto a row so the calendar hides it even if the API omits confirm status. */
export function appointmentWithCancelledFields(
  row: Appointment,
  cancellationReason?: string | null
): Appointment {
  const out = { ...row } as Appointment & Record<string, unknown>;
  out.confirmStatusName = PRACTICE_CALENDAR_CANCEL_CONFIRM_STATUS;
  out.cancellationFlag = true;
  if (cancellationReason?.trim()) {
    out.cancellationReason = cancellationReason.trim();
  }
  out.isActive = false;
  return out;
}

function cancelAppointmentApiErrorMessage(e: unknown): string {
  const ax = e as { response?: { data?: { message?: string | string[] } }; message?: string };
  const m = ax?.response?.data?.message;
  if (Array.isArray(m)) return m.join(', ');
  if (typeof m === 'string') return m.trim();
  return ax?.message?.trim() ?? '';
}

function appointmentCancelBlockedByClientRequirement(message: string): boolean {
  return /requires a client/i.test(message);
}

function appointmentCancelBlockedByInvalidTimes(message: string): boolean {
  return /appointmentEnd must be after appointmentStart/i.test(message);
}

/**
 * All-day rows sometimes store `appointmentEnd` at the same instant as `appointmentStart`
 * (single-day span). PATCH cancel re-validates times — send exclusive next-day end.
 */
function allDayCancelPayloadExtras(appt: Appointment): Record<string, unknown> {
  if (!appt.allDay) return {};
  const extras: Record<string, unknown> = { allDay: true };
  const startIso = appt.appointmentStart?.trim();
  const endIso = appt.appointmentEnd?.trim();
  if (!startIso) return extras;
  const startMs = Date.parse(startIso);
  const endMs = endIso ? Date.parse(endIso) : NaN;
  if (Number.isFinite(startMs) && (!Number.isFinite(endMs) || endMs <= startMs)) {
    const endFixed = DateTime.fromISO(startIso, { zone: 'utc' }).plus({ days: 1 }).toUTC().toISO();
    if (endFixed) {
      extras.appointmentStart = startIso;
      extras.appointmentEnd = endFixed;
    }
  }
  return extras;
}

export async function cancelAppointment(
  id: number | string,
  body: CancelAppointmentPatch,
  opts?: { practiceId?: number | string; appt?: Appointment | null }
): Promise<Appointment> {
  const trimmedReason = body.cancellationReason?.trim();
  const appt = opts?.appt ?? null;
  const payload: Record<string, unknown> = {
    cancellationFlag: true,
    confirmStatusName: PRACTICE_CALENDAR_CANCEL_CONFIRM_STATUS,
    ...(trimmedReason ? { cancellationReason: trimmedReason } : {}),
    ...(appt ? allDayCancelPayloadExtras(appt) : {}),
  };
  const patchOpts = opts?.practiceId != null ? { practiceId: opts.practiceId } : undefined;
  try {
    const data = await patchAppointment(id, payload, patchOpts);
    return appointmentWithCancelledFields(data, trimmedReason ?? body.cancellationReason ?? null);
  } catch (e: unknown) {
    const message = cancelAppointmentApiErrorMessage(e);
    const noClientOnRow = appt != null && !appt.client;
    if (
      message &&
      appointmentCancelBlockedByClientRequirement(message) &&
      appt != null &&
      (isPracticeCalendarBlockAppointment(appt) || noClientOnRow)
    ) {
      await deleteAppointment(id);
      return appointmentWithCancelledFields(appt, trimmedReason ?? body.cancellationReason ?? null);
    }
    if (
      message &&
      appointmentCancelBlockedByInvalidTimes(message) &&
      appt != null &&
      (appt.allDay || isPracticeCalendarBlockAppointment(appt) || noClientOnRow)
    ) {
      await deleteAppointment(id);
      return appointmentWithCancelledFields(appt, trimmedReason ?? body.cancellationReason ?? null);
    }
    throw e;
  }
}

/** PUT /appointments/:id/alternate-address — upsert or clear stored alternate (max 4000 chars). */
export type SetAppointmentAlternateAddressDto = {
  /** Non-empty trimmed text upserts; omit, `null`, or `""` removes the row. */
  addressText?: string | null;
};

export async function putAppointmentAlternateAddress(
  id: number | string,
  body: SetAppointmentAlternateAddressDto
): Promise<void> {
  await http.put(`/appointments/${encodeURIComponent(String(id))}/alternate-address`, body);
}

/** DELETE /appointments/:id */
export async function deleteAppointment(id: number | string): Promise<void> {
  await http.delete(`/appointments/${encodeURIComponent(String(id))}`);
}

/** Body for POST /appointments/:id/actual-start and .../actual-end */
export type AppointmentActualTimeBody = {
  /** Strict ISO8601 with offset or Z; omit for server “now”. */
  at?: string;
  clear?: boolean;
};

/** POST /appointments/:id/actual-start — record or clear real visit start. */
export async function postAppointmentActualStart(
  id: number | string,
  body: AppointmentActualTimeBody = {}
): Promise<Appointment> {
  const { data } = await http.post<Appointment>(
    `/appointments/${encodeURIComponent(String(id))}/actual-start`,
    body
  );
  return data;
}

/** POST /appointments/:id/actual-end — record or clear real visit end. */
export async function postAppointmentActualEnd(
  id: number | string,
  body: AppointmentActualTimeBody = {}
): Promise<Appointment> {
  const { data } = await http.post<Appointment>(
    `/appointments/${encodeURIComponent(String(id))}/actual-end`,
    body
  );
  return data;
}

export type Depot = {
  lat: number;
  lon: number;
  /** When API sends a depot locality label (morning / start depot). */
  town?: string;
  city?: string;
  address?: string;
  address1?: string;
  displayName?: string;
  name?: string;
};

function pickDepotStr(depot: Depot, key: keyof Depot): string | null {
  if (key === 'lat' || key === 'lon') return null;
  const v = depot[key];
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t || null;
}

/**
 * Town / city label for “Office: …” when encoded on `startDepot` (town/city/address fields).
 * Prefer top-level {@link DoctorDayResponse.startDepotTown} from GET /appointments/doctor when present.
 */
export function depotOfficeTownLabel(depot: Depot | null | undefined): string | null {
  if (!depot) return null;
  const loose = depot as Record<string, unknown>;
  const fromLabel =
    typeof loose.label === 'string' && loose.label.trim() ? loose.label.trim() : null;
  return (
    pickDepotStr(depot, 'town') ??
    pickDepotStr(depot, 'city') ??
    pickDepotStr(depot, 'displayName') ??
    pickDepotStr(depot, 'name') ??
    fromLabel ??
    townHintFromAddressString(pickDepotStr(depot, 'address') ?? pickDepotStr(depot, 'address1') ?? '')
  );
}

/** Pull a locality from a comma-separated formatted address (e.g. reverse-geocode). */
export function townHintFromAddressString(address: string): string | null {
  const raw = address?.trim();
  if (!raw) return null;
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0]!.length <= 48 ? parts[0]! : null;
  if (parts.length >= 3) {
    const mid = parts[1]!;
    if (mid && !/^\d+$/.test(mid)) return mid;
  }
  const first = parts[0]!;
  if (first && !/^\d/.test(first)) return first;
  return parts[1] ?? null;
}

export type MiniZone = { id: number | string; name: string | null } | null;

/** Small chart PCP ref from GET /appointments/doctor (not full EmployeeDto). */
export type DoctorDayPatientPrimaryProvider = {
  id: number;
  firstName?: string | null;
  lastName?: string | null;
  /** Degree / credentials (e.g. D.V.M., BVMS) — shown after name when present. */
  designation?: string | null;
  title?: string | null;
};

function doctorDayPhoneStr(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/** Primary + secondary client phones from a doctor-day appointment row (or nested `client`). */
export function clientPhoneLineFromDoctorDayPayload(a: unknown): string | undefined {
  if (!a || typeof a !== 'object') return undefined;
  const row = a as Record<string, unknown>;
  const client =
    row.client && typeof row.client === 'object' ? (row.client as Record<string, unknown>) : null;
  const phone1 =
    doctorDayPhoneStr(row.clientPhone1) ??
    doctorDayPhoneStr(row.phone1) ??
    (client ? doctorDayPhoneStr(client.phone1) : undefined) ??
    (client ? doctorDayPhoneStr(client.phone) : undefined) ??
    doctorDayPhoneStr(row.clientPhone) ??
    doctorDayPhoneStr(row.phone) ??
    (client ? doctorDayPhoneStr(client.mobilePhone) : undefined) ??
    (client ? doctorDayPhoneStr(client.homePhone) : undefined) ??
    (client ? doctorDayPhoneStr(client.primaryPhone) : undefined);
  const phone2 =
    doctorDayPhoneStr(row.clientPhone2) ??
    doctorDayPhoneStr(row.phone2) ??
    (client ? doctorDayPhoneStr(client.phone2) : undefined);
  const unique = [...new Set([phone1, phone2].filter(Boolean) as string[])];
  return unique.length ? unique.join(' · ') : undefined;
}

function mergeRecordObjects(
  a: Record<string, unknown> | null | undefined,
  b: Record<string, unknown> | null | undefined
): Record<string, unknown> | undefined {
  if (!a && !b) return undefined;
  return { ...(a ?? {}), ...(b ?? {}) };
}

/**
 * Overlay calendar-range client contact and clinical fields onto doctor-day rows.
 * Doctor-day (`GET /appointments/doctor`) is routing-focused; range (`GET /appointments/range`) has full visit detail.
 */
export function mergeRangeClientContactOntoDoctorDayAppts(
  appts: DoctorDayAppt[],
  rangeAppts: readonly Appointment[]
): DoctorDayAppt[] {
  const byId = new Map<string, Appointment>();
  for (const a of rangeAppts) {
    if (a?.id == null) continue;
    byId.set(String(a.id), a);
  }
  if (!byId.size) return appts;

  return appts.map((appt) => {
    if (appt.isPersonalBlock || appt.type === 'block' || appt.isBlock) return appt;
    const full = appt.id != null ? byId.get(String(appt.id)) : undefined;
    if (!full) return appt;

    const mergedClient = mergeRecordObjects(
      appt.client as Record<string, unknown> | undefined,
      full.client as Record<string, unknown> | undefined
    );
    const mergedPatient = mergeRecordObjects(
      appt.patient as Record<string, unknown> | undefined,
      full.patient as unknown as Record<string, unknown> | undefined
    );
    const altText = appointmentAlternateAddressText(full);
    const hasAlt = appointmentHasAlternateLocation(full);
    const next: DoctorDayAppt = {
      ...appt,
      confirmStatusName: appt.confirmStatusName ?? full.confirmStatusName ?? undefined,
      description: appt.description?.trim() || full.description?.trim() || appt.description,
      instructions: appt.instructions?.trim() || full.instructions?.trim() || appt.instructions,
      alerts:
        appt.alerts?.trim() ||
        full.patient?.alerts?.trim() ||
        appt.alerts ||
        undefined,
      ...(mergedClient ? { client: mergedClient } : {}),
      ...(mergedPatient ? { patient: mergedPatient } : {}),
      ...(altText
        ? {
            alternateAddressText: altText,
            alternateAddress:
              full.alternateAddress ??
              ({ addressText: altText } as DoctorDayAppt['alternateAddress']),
          }
        : {}),
      ...(hasAlt ? { isAlternateStop: true } : {}),
    };
    const clientPhone = appt.clientPhone ?? clientPhoneLineFromDoctorDayPayload(next);
    return clientPhone ? { ...next, clientPhone } : next;
  });
}

const DEFAULT_PRACTICE_ID = Number(import.meta.env.VITE_PRACTICE_ID) || 1;

/** UTC bounds for one local calendar day (same shape as scheduler range queries). */
export function localDayUtcRange(
  dateIso: string,
  practiceTz: string
): { start: string; end: string } {
  const tz = practiceTimeZoneOrDefault(practiceTz);
  const day = DateTime.fromISO(dateIso, { zone: tz });
  return {
    start: day.startOf('day').toUTC().toISO()!,
    end: day.endOf('day').toUTC().toISO()!,
  };
}

/** Full calendar appointments for one provider day — used to enrich My Day PDF / visual with client phones. */
export async function fetchAppointmentsRangeForLocalDay(params: {
  dateIso: string;
  practiceTimeZone: string;
  primaryProviderId: string | number;
  practiceId?: number;
}): Promise<Appointment[]> {
  const { start, end } = localDayUtcRange(params.dateIso, params.practiceTimeZone);
  return fetchAppointmentsRange({
    practiceId: params.practiceId ?? DEFAULT_PRACTICE_ID,
    start,
    end,
    primaryProviderId: params.primaryProviderId,
  });
}

export type DoctorDayAppt = {
  id: number | string;
  clientName: string;
  clientPimsId?: string;
  clientAlert?: string;
  /** Formatted client phone(s) when returned on doctor-day rows. */
  clientPhone?: string;
  /** Nested client when returned by doctor-day API (phone, email, etc.). */
  client?: Record<string, unknown> | null;
  patientName?: string;
  patientPimsId?: string;
  confirmStatusName?: string;

  lat?: number;
  lon?: number;

  startIso?: string;
  endIso?: string;
  /** Booked visit times when doctor-day includes them (edit-time preview / ETA). */
  appointmentStart?: string;
  appointmentEnd?: string;
  serviceMinutes?: number;
  appointmentType?: string;

  address1?: string;
  city?: string;
  state?: string;
  zip?: string;

  description?: string;
  visitReason?: string;
  /** Staff notes (PIMS instructions). */
  instructions?: string;
  statusName?: string;

  expectedArrivalIso?: string;
  routingAvailable?: boolean;
  isNoLocation?: boolean;

  // Block fields (doctor-day merged list + ETA byIndex)
  /** Doctor-day merged list: 'appointment' | 'block'. ETA byIndex may also set this. */
  type?: 'appointment' | 'block';
  /** Set on both doctor-day and ETA byIndex for blocks. */
  isBlock?: boolean;
  /** Legacy/alternative block flag; same meaning as type === 'block' / isBlock. */
  isPersonalBlock?: boolean;
  /** Prefer this for block label (e.g. "Block", "Personal block"); else title, else "Block". */
  blockLabel?: string;
  /** Title for blocks when blockLabel is not set. */
  title?: string;

  // Fixed time appointment (no flexible window)
  isFixed?: boolean;
  fixedTime?: boolean;
  isFlexible?: boolean;

  // Zones
  clientZone?: MiniZone;
  effectiveZone?: MiniZone;

  /** Appointment window from backend (when available); use instead of frontend-calculated window */
  effectiveWindow?: { startIso: string; endIso: string };

  /** One-team / membership: client is an active member */
  isMember?: boolean;
  /** Display name of the membership tier/plan when `isMember` */
  membershipName?: string | null;

  /** Chart primary provider for the patient on this visit (GET /appointments/doctor); null if none. */
  patientPrimaryProvider?: DoctorDayPatientPrimaryProvider | null;
  /** PIMS/eVet visit complete (GET /appointments/doctor; not Scout actual times). */
  isComplete?: boolean;
  /** Nested patient row when returned by doctor-day API (sex, alerts, etc.). */
  patient?: Record<string, unknown> | null;
  /** Pet-level alerts when returned at appointment root (doctor-day / range). */
  alerts?: string | null;
  /** Routing alternate stop — visit at this address instead of client home. */
  alternateAddressText?: string;
  isAlternateStop?: boolean;
  alternateAddress?: { addressText?: string } | Record<string, unknown> | null;
}

/** Item may be an appointment (doctor-day) or ETA byIndex row (has key). */
export function isBlockEntry(item: {
  type?: string;
  isBlock?: boolean;
  isPersonalBlock?: boolean;
  key?: string;
} | null | undefined): boolean {
  if (!item) return false;
  if (item.type === 'block') return true;
  if (item.isBlock === true) return true;
  if (item.isPersonalBlock === true) return true;
  if (typeof item.key === 'string' && item.key.startsWith('noloc:')) return true;
  return false;
}

/** True when the block is a "Flex Block" (routing stand-in; same treatment as personal block for drive logic). */
export function isFlexBlockItem(item: { blockLabel?: string; title?: string } | null | undefined): boolean {
  if (!item) return false;
  const label = (item.blockLabel ?? item.title ?? '').trim().toLowerCase();
  return label === 'flex block';
}

/** Label for a block entry: blockLabel ?? title ?? 'Personal Block'. Never use client/patient name for blocks. */
export function blockDisplayLabel(item: { blockLabel?: string; title?: string } | null | undefined): string {
  if (!item) return 'Personal Block';
  let label = (item.blockLabel ?? item.title ?? '').trim();
  if (!label) return 'Personal Block';
  if (label.toLowerCase() === 'client') return 'Personal Block';
  if (label.toLowerCase() === 'flex block') return 'Flex Block';
  // ETA/routing may prefix with duplicated tokens (e.g. "BLOCK BLOCK Greg …"); keep one BLOCK + rest.
  label = label.replace(/^block(?:\s+block)+(?=\s|$)/i, 'BLOCK').trim();
  // Backend sometimes sends repeated tokens only (e.g. "BLOCK BLOCK"); show once.
  const parts = label.split(/\s+/).filter(Boolean);
  if (parts.length > 1) {
    const low0 = parts[0].toLowerCase();
    if (parts.every((p) => p.toLowerCase() === low0)) {
      if (low0 === 'block') return 'BLOCK';
      return parts[0].charAt(0).toUpperCase() + parts[0].slice(1).toLowerCase();
    }
  }
  return label;
}

export type DoctorDayResponse = {
  date?: string;
  /** IANA timezone for schedule wall times (e.g. America/New_York). */
  timezone: string;
  startDepot?: Depot | null;
  endDepot?: Depot | null;
  /** Locality for morning office (e.g. "Brunswick"); no client reverse-geocode when set. */
  startDepotTown?: string | null;
  startDepotTime: any;
  endDepotTime: any;
  appointments: DoctorDayAppt[];
};

export const miniZoneFromPayload = (z: any): MiniZone => {
  if (!z) return null;
  if (typeof z === 'object') {
    const id = z.id ?? z.zoneId ?? z.clientZoneId;
    const name = z.name ?? z.zoneName ?? z.clientZoneName ?? null;
    return id != null ? { id, name } : null;
  }
  return { id: z, name: null };
};

function trimStrUnknown(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

export function normalizeDoctorDayPatientPrimaryProvider(
  raw: unknown
): DoctorDayPatientPrimaryProvider | null {
  if (raw == null || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const idNum = typeof o.id === 'number' ? o.id : typeof o.id === 'string' ? Number(o.id) : NaN;
  if (!Number.isFinite(idNum)) return null;
  const fn = trimStrUnknown(o.firstName);
  const ln = trimStrUnknown(o.lastName);
  if (!fn && !ln) return null;
  const designation = trimStrUnknown(o.designation) ?? trimStrUnknown(o.credentials);
  const title = trimStrUnknown(o.title);
  return { id: idNum, firstName: fn, lastName: ln, designation: designation ?? undefined, title: title ?? undefined };
}

function zoneNameFromMiniZoneShape(z: unknown): string | null {
  if (z == null || typeof z !== 'object') return null;
  const o = z as Record<string, unknown>;
  return trimStrUnknown(o.name) ?? trimStrUnknown(o.zoneName) ?? trimStrUnknown(o.clientZoneName);
}

/**
 * Raw zone name from appointment-like payloads: checks root `effectiveZone` / `clientZone` / `zoneName`,
 * then the same on nested `client` (as returned by GET /appointments/range for many practices).
 */
export function appointmentZoneFullName(carrier: unknown): string | null {
  if (carrier == null || typeof carrier !== 'object') return null;
  const o = carrier as Record<string, unknown>;
  const fromRoot =
    zoneNameFromMiniZoneShape(o.effectiveZone) ??
    zoneNameFromMiniZoneShape(o.clientZone) ??
    trimStrUnknown(o.zoneName);
  if (fromRoot) return fromRoot;
  const client = o.client;
  if (client == null || typeof client !== 'object') return null;
  const c = client as Record<string, unknown>;
  return (
    zoneNameFromMiniZoneShape(c.effectiveZone) ??
    zoneNameFromMiniZoneShape(c.clientZone) ??
    trimStrUnknown(c.zoneName)
  );
}

/** From full zone name like "Zone 3E (Home)" or "2E:" return short label "3E" / "2E" only. */
export function shortZoneLabel(fullName: string | null | undefined): string | null {
  const s = fullName?.trim();
  if (!s) return null;
  // Strip "Zone " prefix and any trailing " (Something)" to get e.g. "3E"
  let out = s.replace(/^Zone\s+/i, '').trim();
  out = out.replace(/\s*\([^)]*\)\s*$/, '').trim();
  // Strip trailing colon if backend sends e.g. "2E:"
  out = out.replace(/:+$/, '').trim();
  return out || s.replace(/:+$/, '').trim();
}

/** Short routing zone code (e.g. `3E`) from appointment / doctor-day payload, including nested `client`. */
export function appointmentZoneShortLabel(carrier: unknown): string | null {
  const full = appointmentZoneFullName(carrier);
  return full ? shortZoneLabel(full) : null;
}

/** Display client name with zone or city in parentheses when available, e.g. "Martha Fogler (3E)" or "Martha Fogler (Boston)". Zone shows short label only (e.g. "3E"), not "Zone 3E (Home)". */
export function clientDisplayName(a: {
  clientName?: string | null;
  clientZone?: MiniZone;
  effectiveZone?: MiniZone;
  city?: string | null;
} | null): string {
  const name = (a?.clientName ?? 'Client').trim();
  if (!name) return 'Client';
  const fullZoneName = appointmentZoneFullName(a);
  const zoneLabel = fullZoneName ? shortZoneLabel(fullZoneName) : null;
  const city = (a?.city ?? (a as any)?.city)?.trim();
  const suffix = zoneLabel || city;
  return suffix ? `${name} (${suffix})` : name;
}

/**
 * Purple routing preview on My Day / My Week: shows **New Appointment** (or `clientName`) with the same
 * parenthetical **zone or city** rules as {@link clientDisplayName}.
 *
 * **Data:** You only get **(3E)**-style suffixes when the candidate payload includes `clientZone` and/or
 * `effectiveZone` (or `city` for city fallback). If the routing API does not send zones yet, the label
 * stays **New Appointment** with no parentheses.
 */
export function previewRoutingAppointmentLabel(
  a: { clientName?: string | null; clientZone?: MiniZone; effectiveZone?: MiniZone; city?: string | null } | null
): string {
  const base = (a?.clientName ?? 'New Appointment').trim() || 'New Appointment';
  return clientDisplayName({
    clientName: base,
    clientZone: a?.clientZone,
    effectiveZone: a?.effectiveZone,
    city: a?.city ?? null,
  });
}

export async function fetchDoctorDay(
  dateISO: string,
  doctorId?: string
): Promise<DoctorDayResponse> {
  const params: Record<string, string> = { date: dateISO };
  if (doctorId && String(doctorId).trim() !== '') params.doctorId = String(doctorId);

  // inside fetchDoctorDay(...)

  const { data } = await http.get('/appointments/doctor', { params });

  // --- map normal appointments (existing code) ---
  const rows: any[] = data?.appointments ?? data ?? [];
  const appointments: DoctorDayAppt[] = rows.map((a) => {
    const lat = typeof a?.lat === 'number' ? a.lat : undefined;
    const lon = typeof a?.lon === 'number' ? a.lon : undefined;

    const backendNoLoc =
      Boolean(a?.isNoLocation ?? a?.noLocation ?? a?.unroutable) || a?.routingAvailable === false;
    return {
      id: a?.id,
      clientName: a?.clientName ?? 'Client',
      clientPimsId: a?.clientPimsId,
      clientAlert: a?.clientAlert,
      clientPhone: clientPhoneLineFromDoctorDayPayload(a),
      client: a?.client && typeof a.client === 'object' ? a.client : undefined,
      patientName: a?.patientName,
      alerts: a?.alerts,
      patientPimsId: a?.patientPimsId,
      confirmStatusName: a?.confirmStatusName ?? undefined,
      appointmentType: a?.appointmentType?.name ?? a?.appointmentType ?? undefined,

      lat,
      lon,

      startIso: a?.startIso ?? a?.appointmentStart ?? a?.scheduledStartIso,
      endIso: a?.endIso ?? a?.appointmentEnd ?? a?.scheduledEndIso,

      address1: a?.address1 ?? undefined,
      city: a?.city ?? undefined,
      state: a?.state ?? undefined,
      zip: a?.zip ?? undefined,

      description: a?.description,
      visitReason: a?.visitReason,
      instructions: a?.instructions ?? undefined,
      statusName: a?.statusName,

      expectedArrivalIso: a?.expectedArrivalIso ?? undefined,
      routingAvailable: a?.routingAvailable,
      isNoLocation: backendNoLoc || !(typeof lat === 'number' && typeof lon === 'number'),

      // Fixed time fields
      isFixed: a?.isFixed ?? undefined,
      fixedTime: a?.fixedTime ?? undefined,
      isFlexible: a?.isFlexible ?? undefined,

      clientZone: miniZoneFromPayload(a?.clientZone),
      effectiveZone: miniZoneFromPayload(a?.effectiveZone),

      effectiveWindow:
        a?.effectiveWindow?.startIso && a?.effectiveWindow?.endIso
          ? { startIso: a.effectiveWindow.startIso, endIso: a.effectiveWindow.endIso }
          : undefined,

      ...(() => {
        const pat = a?.patient;
        const isMember = a?.isMember === true || pat?.isMember === true;
        const rawMem = a?.membershipName ?? pat?.membershipName;
        let membershipName: string | undefined;
        if (typeof rawMem === 'string' && rawMem.trim() !== '') membershipName = rawMem.trim();
        else if (rawMem != null && String(rawMem).trim() !== '') membershipName = String(rawMem).trim();
        return { isMember, membershipName };
      })(),
      patientPrimaryProvider: normalizeDoctorDayPatientPrimaryProvider(a?.patientPrimaryProvider),
      patient: a?.patient && typeof a.patient === 'object' ? a.patient : undefined,
      isComplete: a?.isComplete === true,
      alternateAddressText: appointmentAlternateAddressText(a) ?? undefined,
      isAlternateStop: appointmentHasAlternateLocation(a) ? true : undefined,
      alternateAddress:
        a?.alternateAddress && typeof a.alternateAddress === 'object' ? a.alternateAddress : undefined,
    };
  });

  // --- Map personal blocks from the server (doctor-day merged visit order) ---
  const blockRows: any[] = Array.isArray(data?.personalBlocks) ? data.personalBlocks : [];
  const blockAppts: DoctorDayAppt[] = blockRows.map((b) => ({
    id: b?.id ?? `block-${String(b?.startIso || b?.appointmentStart || '')}`,
    clientName: b?.title ?? 'Block',
    appointmentType: b?.blockLabel ?? b?.title ?? 'Block',
    description: b?.description,
    // never routable, no coordinates:
    routingAvailable: false,
    isNoLocation: true,
    startIso: b?.startIso ?? b?.appointmentStart ?? undefined,
    endIso: b?.endIso ?? b?.appointmentEnd ?? undefined,
    type: 'block',
    isBlock: true,
    isPersonalBlock: true,
    blockLabel: b?.blockLabel ?? b?.title,
    title: b?.title,
  }));

  // Combine & let the page sort by start time as usual
  const combined: DoctorDayAppt[] = [...appointments, ...blockAppts];

  return {
    date: data?.date,
    timezone: practiceTimeZoneOrDefault(
      typeof (data as any)?.timezone === 'string' ? (data as any).timezone : undefined
    ),
    startDepot: data?.startDepot ?? null,
    endDepot: data?.endDepot ?? null,
    startDepotTown: trimStrUnknown((data as any)?.startDepotTown),
    startDepotTime: data?.startDepotTime,
    endDepotTime: data?.endDepotTime,
    appointments: combined,
  };
}

/* =========================
   Doctor Month API (NEW)
   ========================= */

export type DoctorMonthAppt = {
  id: number | string;
  startIso: string;
  endIso: string;
  title?: string;
  serviceMinutes?: number;
  /** Type name for points when id is unavailable. */
  appointmentType?: string;
  appointmentTypeId?: number;

  /** Client id for multi-pet detection (same client + same time = one block, divide time by N). */
  clientId?: number | string | null;
  clientPimsId?: string | null;

  // Zones per appointment (same semantics as day API)
  clientZone?: MiniZone;
  effectiveZone?: MiniZone;
};

/** Booked minutes for doctor-month / appt-length stats; falls back to start/end when serviceMinutes is omitted. */
export function doctorMonthApptBookedMinutes(
  a: Pick<DoctorMonthAppt, 'serviceMinutes' | 'startIso' | 'endIso'>
): number {
  if (typeof a.serviceMinutes === 'number' && Number.isFinite(a.serviceMinutes) && a.serviceMinutes > 0) {
    return a.serviceMinutes;
  }
  const startRaw = a.startIso?.trim();
  const endRaw = a.endIso?.trim();
  if (!startRaw || !endRaw) return 0;
  const startMs = Date.parse(startRaw);
  const endMs = Date.parse(endRaw);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return 0;
  return Math.max(1, Math.round((endMs - startMs) / 60_000));
}

export type DoctorMonthBlock = {
  id: number | string;
  startIso: string;
  endIso: string;
  title?: string;
};

export type DoctorMonthDay = {
  date: string; // YYYY-MM-DD
  timezone: string;
  workStartLocal?: string;
  workEndLocal?: string;
  appts: DoctorMonthAppt[];
  blocks: DoctorMonthBlock[];
  // driveSeconds?: number; // if you add later
};

export type DoctorMonthResponse = {
  doctorId: string;
  year: number;
  month: number; // 1-12
  timezone: string;
  days: DoctorMonthDay[];
};

export async function fetchDoctorMonth(
  year: number,
  month: number, // 1-12
  doctorId?: string
): Promise<DoctorMonthResponse> {
  const params: Record<string, string | number> = { year, month };
  if (doctorId && String(doctorId).trim() !== '') params.doctorId = String(doctorId);

  const { data } = await http.get('/appointments/doctor/month', { params });

  // Map zones and appointmentType (for VSD points); gracefully handle servers that don’t send zone fields
  const days: DoctorMonthDay[] = (data?.days ?? []).map((d: any) => ({
    date: d?.date,
    timezone: d?.timezone,
    workStartLocal: d?.workStartLocal,
    workEndLocal: d?.workEndLocal,
    appts: (d?.appts ?? []).map((a: any) => {
      const startIso = a?.startIso ?? a?.appointmentStart ?? a?.scheduledStartIso ?? '';
      const endIso = a?.endIso ?? a?.appointmentEnd ?? a?.scheduledEndIso ?? '';
      const mapped: DoctorMonthAppt = {
        id: a?.id,
        startIso,
        endIso,
        title: a?.title,
        appointmentType: a?.appointmentType?.name ?? a?.appointmentType ?? undefined,
        appointmentTypeId:
          a?.appointmentType?.id != null
            ? Number(a.appointmentType.id)
            : a?.appointmentTypeId != null
              ? Number(a.appointmentTypeId)
              : undefined,
        clientId: a?.clientId ?? a?.client?.id ?? undefined,
        clientPimsId: a?.clientPimsId ?? a?.client?.pimsId ?? undefined,
        clientZone: miniZoneFromPayload(a?.clientZone),
        effectiveZone: miniZoneFromPayload(a?.effectiveZone),
      };
      mapped.serviceMinutes = doctorMonthApptBookedMinutes(mapped);
      return mapped;
    }),
    blocks: (d?.blocks ?? []).map((b: any) => ({
      id: b?.id,
      startIso: b?.startIso,
      endIso: b?.endIso,
      title: b?.title,
    })),
  }));

  return {
    doctorId: String(data?.doctorId ?? doctorId ?? ''),
    year: Number(data?.year ?? year),
    month: Number(data?.month ?? month),
    timezone: data?.timezone ?? days[0]?.timezone ?? 'America/New_York',
    days,
  };
}

// src/api/forwardBooking.ts
import { http } from './http';
import type { Appointment } from './roomLoader';

export type ForwardBookingIntervalUnit = 'days' | 'weeks' | 'months';

export type ForwardBookingStatus = 'pending' | 'booked' | 'complete' | 'removed';

/** Immutable source captured at POST /forward-bookings (or server-set on POST /appointments). */
export type ForwardBookingCreatedVia =
  | 'care_outreach'
  | 'schedule_loader'
  | 'end_visit'
  | 'manual'
  | 'appointment_request'
  | 'unknown';

const FORWARD_BOOKING_CREATED_VIA_VALUES = new Set<string>([
  'care_outreach',
  'schedule_loader',
  'end_visit',
  'manual',
  'appointment_request',
  'unknown',
]);

export function normalizeForwardBookingCreatedVia(
  raw: unknown
): ForwardBookingCreatedVia | null {
  if (raw == null) return null;
  const s = String(raw).trim().toLowerCase();
  if (s === 'forward_booking') return 'end_visit';
  if (FORWARD_BOOKING_CREATED_VIA_VALUES.has(s)) return s as ForwardBookingCreatedVia;
  return null;
}

/** Values accepted by POST /forward-bookings (not `unknown` / `appointment_request`). */
export type CreatableForwardBookingCreatedVia =
  | 'care_outreach'
  | 'end_visit'
  | 'manual'
  | 'schedule_loader';

const CREATABLE_FORWARD_BOOKING_CREATED_VIA = new Set<CreatableForwardBookingCreatedVia>([
  'care_outreach',
  'end_visit',
  'manual',
  'schedule_loader',
]);

export type ForwardBookingClientRef = {
  id: number;
  pimsId?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  phone1?: string | null;
  alerts?: string | null;
  address1?: string | null;
  city?: string | null;
  state?: string | null;
  zipcode?: string | null;
  lat?: number | null;
  lon?: number | null;
};

export type ForwardBookingPatientRef = {
  id: number;
  pimsId?: string | null;
  name?: string | null;
};

export type ForwardBookingProviderRef = {
  id?: number;
  pimsId?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  name?: string | null;
};

export type ForwardBookingEmployeeRef = {
  id?: number;
  firstName?: string | null;
  lastName?: string | null;
  name?: string | null;
  title?: string | null;
  designation?: string | null;
};

export type ForwardBookingAppointmentTypeRef = {
  id?: number;
  name?: string | null;
  prettyName?: string | null;
};

/** Active forward-booking row returned by GET /forward-bookings. */
export type ForwardBookingEntry = {
  id: number;
  /** Opaque token — pass on POST /appointments and POST …/complete for routing attribution. */
  trackingToken: string;
  practiceId?: number;
  status: ForwardBookingStatus;
  /** Legacy rows — prefer `intervalAmount` + `intervalUnit`. */
  monthsOut?: number | null;
  intervalAmount?: number | null;
  intervalUnit?: ForwardBookingIntervalUnit | string | null;
  /** Target date staff should book toward (source visit + interval). */
  targetDueDate?: string | null;
  /** Visit that ended with forward-book request (ISO UTC). */
  sourceAppointmentStart?: string | null;
  sourceAppointmentEnd?: string | null;
  /** Omitted or null when staff added forward booking without a source visit. */
  sourceAppointmentId?: number | null;
  clientId: number;
  patientId: number;
  appointmentTypeId?: number | null;
  appointmentTypeName?: string | null;
  serviceMinutes?: number | null;
  description?: string | null;
  instructions?: string | null;
  client?: ForwardBookingClientRef | null;
  patient?: ForwardBookingPatientRef | null;
  primaryProvider?: ForwardBookingProviderRef | null;
  /** Set when status is `booked`. */
  bookedAppointmentId?: number | null;
  bookedAppointmentStart?: string | null;
  bookedAppointmentEnd?: string | null;
  /** Ops points on the linked calendar visit (from server when `bookedAppointmentId` is set). */
  linkedVisitPoints?: number | null;
  /** True when the linked calendar visit was cancelled. */
  linkedVisitCancelled?: boolean;
  /** When the linked visit was placed on the calendar (ISO UTC). */
  linkedVisitBookedAtIso?: string | null;
  /** Staff note on the queue entry (editable on forward booking list). */
  note?: string | null;
  /** Notes for the follow-up booking — set when ending the source visit. */
  bookingNotes?: string | null;
  /** Employee who linked the future appointment (when status is `booked`). */
  bookedBy?: ForwardBookingEmployeeRef | null;
  /**
   * When set to a future calendar date (`yyyy-MM-dd` or ISO), row is deferred to Book later
   * until that date (practice TZ). Cleared or ≤ today → Needs booking.
   */
  bookAfterDate?: string | null;
  /** Where the queue row was created — do not infer from bookingNotes. */
  createdVia?: ForwardBookingCreatedVia | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type FetchForwardBookingsParams = {
  practiceId: number;
  /** ISO datetime — hide entries whose booked visit start is before this (default server now). */
  asOf?: string;
  limit?: number;
  /** When true, include rows with `status: removed` (for the Removed tab). */
  includeRemoved?: boolean;
};

function pickIso(v: unknown): string | null {
  if (typeof v !== 'string' || !v.trim()) return null;
  return v.trim();
}

/** Map nested / alternate API shapes onto flat entry fields. */
export function normalizeForwardBookingEntry(raw: unknown): ForwardBookingEntry {
  const row = { ...(raw as ForwardBookingEntry) };
  if (!raw || typeof raw !== 'object') return row;
  const o = raw as Record<string, unknown>;
  const src = o.sourceAppointment;
  if (src && typeof src === 'object') {
    const s = src as Record<string, unknown>;
    if (!row.sourceAppointmentStart) {
      row.sourceAppointmentStart = pickIso(s.appointmentStart) ?? pickIso(s.start) ?? null;
    }
    if (!row.sourceAppointmentEnd) {
      row.sourceAppointmentEnd = pickIso(s.appointmentEnd) ?? pickIso(s.end) ?? null;
    }
  }
  if (!row.sourceAppointmentStart) {
    row.sourceAppointmentStart = pickIso(o.sourceAppointmentStart) ?? null;
  }
  if (!row.sourceAppointmentEnd) {
    row.sourceAppointmentEnd = pickIso(o.sourceAppointmentEnd) ?? null;
  }
  if (!row.bookAfterDate) {
    row.bookAfterDate =
      pickIso(o.bookAfterDate) ?? pickIso(o.book_after_date) ?? row.bookAfterDate ?? null;
  }
  const createdVia = normalizeForwardBookingCreatedVia(o.createdVia ?? o.created_via);
  if (createdVia) row.createdVia = createdVia;
  const linkedVisitPoints = o.linkedVisitPoints ?? o.linked_visit_points;
  if (linkedVisitPoints != null && linkedVisitPoints !== '') {
    const n = Number(linkedVisitPoints);
    if (Number.isFinite(n)) row.linkedVisitPoints = n;
  }
  const linkedVisitCancelled = o.linkedVisitCancelled ?? o.linked_visit_cancelled;
  if (typeof linkedVisitCancelled === 'boolean') {
    row.linkedVisitCancelled = linkedVisitCancelled;
  }
  const linkedVisitBookedAtIso =
    pickIso(o.linkedVisitBookedAtIso) ?? pickIso(o.linked_visit_booked_at_iso);
  if (linkedVisitBookedAtIso) row.linkedVisitBookedAtIso = linkedVisitBookedAtIso;
  const booked = o.bookedAppointment;
  if (booked && typeof booked === 'object') {
    const b = booked as Record<string, unknown>;
    if (row.bookedAppointmentId == null) {
      const bid = b.id ?? b.appointmentId;
      if (bid != null && Number.isFinite(Number(bid))) row.bookedAppointmentId = Number(bid);
    }
    if (!row.bookedAppointmentStart) {
      row.bookedAppointmentStart =
        pickIso(b.appointmentStart) ?? pickIso(b.start) ?? row.bookedAppointmentStart ?? null;
    }
    if (!row.bookedAppointmentEnd) {
      row.bookedAppointmentEnd =
        pickIso(b.appointmentEnd) ?? pickIso(b.end) ?? row.bookedAppointmentEnd ?? null;
    }
  }
  return row;
}

function unwrapList(raw: unknown): ForwardBookingEntry[] {
  let list: unknown[] = [];
  if (Array.isArray(raw)) list = raw;
  else if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    if (Array.isArray(o.items)) list = o.items;
    else if (Array.isArray(o.data)) list = o.data;
  }
  return list.map(normalizeForwardBookingEntry);
}

function unwrapEntry(raw: unknown): ForwardBookingEntry {
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    if (o.entry && typeof o.entry === 'object') return normalizeForwardBookingEntry(o.entry);
    if (o.data && typeof o.data === 'object' && !Array.isArray(o.data))
      return normalizeForwardBookingEntry(o.data);
  }
  return normalizeForwardBookingEntry(raw);
}

/**
 * GET /forward-bookings — pending and booked (future visit) forward bookings for scheduling tools.
 */
export async function fetchForwardBookings(
  params: FetchForwardBookingsParams
): Promise<ForwardBookingEntry[]> {
  const { data } = await http.get<unknown>('/forward-bookings', { params });
  return unwrapList(data);
}

/** Lightweight practice-wide index for Scout calendar badge + Start/End Visit modal. */
export type ForwardBookingCalendarIndexResponse = {
  sourceAppointmentIds: number[];
  patientIds: number[];
};

function normalizeCalendarIndexIdList(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const ids = new Set<number>();
  for (const value of raw) {
    const id = Number(value);
    if (Number.isFinite(id) && id > 0) ids.add(id);
  }
  return [...ids].sort((a, b) => a - b);
}

function unwrapCalendarIndex(raw: unknown): ForwardBookingCalendarIndexResponse {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const payload =
    o.data && typeof o.data === 'object' && !Array.isArray(o.data)
      ? (o.data as Record<string, unknown>)
      : o;
  return {
    sourceAppointmentIds: normalizeCalendarIndexIdList(payload.sourceAppointmentIds),
    patientIds: normalizeCalendarIndexIdList(payload.patientIds),
  };
}

/**
 * GET /forward-bookings/calendar-index — source visit + patient ids for Scout calendar.
 * Excludes `removed` rows (no includeRemoved flag).
 */
export async function fetchForwardBookingCalendarIndex(
  practiceId: number
): Promise<ForwardBookingCalendarIndexResponse> {
  const { data } = await http.get<unknown>('/forward-bookings/calendar-index', {
    params: { practiceId },
  });
  return unwrapCalendarIndex(data);
}

export type CreateForwardBookingPayload = {
  practiceId: number;
  /** Omit or null when there is no associated source visit. */
  sourceAppointmentId?: number | null;
  clientId: number;
  patientId: number;
  intervalAmount: number;
  intervalUnit: ForwardBookingIntervalUnit;
  appointmentTypeId?: number;
  primaryProviderId?: number;
  description?: string | null;
  instructions?: string | null;
  serviceMinutes?: number;
  note?: string | null;
  bookingNotes?: string | null;
  /** Omit to infer `end_visit` when `sourceAppointmentId` is set, else `manual`. */
  createdVia?: CreatableForwardBookingCreatedVia;
};

/** POST /forward-bookings — explicit `createdVia`, else infer from source visit. */
export function resolveCreatableForwardBookingCreatedVia(
  body: Pick<CreateForwardBookingPayload, 'createdVia' | 'sourceAppointmentId'>
): CreatableForwardBookingCreatedVia {
  const normalized = normalizeForwardBookingCreatedVia(body.createdVia);
  if (normalized && CREATABLE_FORWARD_BOOKING_CREATED_VIA.has(normalized as CreatableForwardBookingCreatedVia)) {
    return normalized as CreatableForwardBookingCreatedVia;
  }
  const sourceId = body.sourceAppointmentId;
  if (sourceId != null && Number.isFinite(Number(sourceId)) && Number(sourceId) > 0) {
    return 'end_visit';
  }
  return 'manual';
}

/**
 * POST /forward-bookings — create when staff ends a visit and selects a forward-book interval.
 */
export async function createForwardBooking(
  body: CreateForwardBookingPayload
): Promise<ForwardBookingEntry> {
  const createdVia = resolveCreatableForwardBookingCreatedVia(body);
  const { data } = await http.post<unknown>('/forward-bookings', {
    ...body,
    createdVia,
  });
  return unwrapEntry(data);
}

export type CompleteForwardBookingPayload = {
  /** Must match the entry when completing from routing book flow. */
  trackingToken?: string;
  appointmentId: number;
  completedVia: 'routing' | 'manual';
};

/**
 * POST /forward-bookings/:id/complete — mark booked and link the future appointment.
 */
export async function completeForwardBooking(
  forwardBookingId: number,
  body: CompleteForwardBookingPayload
): Promise<ForwardBookingEntry> {
  const { data } = await http.post<unknown>(
    `/forward-bookings/${encodeURIComponent(String(forwardBookingId))}/complete`,
    body
  );
  return unwrapEntry(data);
}

export type PatchForwardBookingBody = {
  practiceId: number;
  /** Send `null` or `""` to clear. */
  note?: string | null;
  bookingNotes?: string | null;
  /** `complete` — staff finished follow-up (moves row off the Booked tab). `removed` — hidden from active tabs. */
  status?: ForwardBookingStatus;
  /** `yyyy-MM-dd` or ISO date — defer to Book later until this day; send `null` to return to Needs booking. */
  bookAfterDate?: string | null;
};

/**
 * PATCH /forward-bookings/:id — update `note`, `bookingNotes`, and/or `status`.
 */
export async function patchForwardBooking(
  forwardBookingId: number,
  body: PatchForwardBookingBody
): Promise<ForwardBookingEntry> {
  const { data } = await http.patch<unknown>(
    `/forward-bookings/${encodeURIComponent(String(forwardBookingId))}`,
    body
  );
  return unwrapEntry(data);
}

/** PATCH /forward-bookings/:id — mark follow-up finished (Booked → Complete tab). */
export async function finishForwardBookingFollowUp(
  forwardBookingId: number,
  practiceId: number
): Promise<ForwardBookingEntry> {
  return patchForwardBooking(forwardBookingId, { practiceId, status: 'complete' });
}

/** PATCH /forward-bookings/:id — remove from active queue (Removed tab). */
export async function removeForwardBooking(
  forwardBookingId: number,
  practiceId: number
): Promise<ForwardBookingEntry> {
  return patchForwardBooking(forwardBookingId, { practiceId, status: 'removed' });
}

/** PATCH /forward-bookings/:id — defer row to Book later until `bookAfterDate`. */
export async function setForwardBookingBookAfterDate(
  forwardBookingId: number,
  practiceId: number,
  bookAfterDate: string
): Promise<ForwardBookingEntry> {
  return patchForwardBooking(forwardBookingId, { practiceId, bookAfterDate });
}

/** PATCH /forward-bookings/:id — clear deferral (Back to queue). */
export async function clearForwardBookingBookAfterDate(
  forwardBookingId: number,
  practiceId: number
): Promise<ForwardBookingEntry> {
  return patchForwardBooking(forwardBookingId, { practiceId, bookAfterDate: null });
}

export type ForwardBookingFutureAppointment = Pick<
  Appointment,
  'id' | 'appointmentStart' | 'appointmentEnd' | 'description' | 'appointmentType' | 'patient' | 'primaryProvider'
>;

/**
 * GET /forward-bookings/:id/future-appointments — candidates for manual complete.
 */
export async function fetchForwardBookingFutureAppointments(
  forwardBookingId: number,
  opts?: { practiceId?: number; asOf?: string }
): Promise<ForwardBookingFutureAppointment[]> {
  const params: Record<string, string> = {};
  if (opts?.practiceId != null) params.practiceId = String(opts.practiceId);
  if (opts?.asOf?.trim()) params.asOf = opts.asOf.trim();
  const { data } = await http.get<unknown>(
    `/forward-bookings/${encodeURIComponent(String(forwardBookingId))}/future-appointments`,
    { params }
  );
  const list = unwrapList(data);
  return list as unknown as ForwardBookingFutureAppointment[];
}

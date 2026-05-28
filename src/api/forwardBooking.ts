// src/api/forwardBooking.ts
import { http } from './http';
import type { Appointment } from './roomLoader';

export type ForwardBookingStatus = 'pending' | 'booked';

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
  monthsOut: number;
  /** Target date staff should book toward (source visit + monthsOut). */
  targetDueDate?: string | null;
  sourceAppointmentId: number;
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
  /** Staff note on the queue entry (editable on forward booking list). */
  note?: string | null;
  /** Notes for the follow-up booking — set when ending the source visit. */
  bookingNotes?: string | null;
  /** Employee who linked the future appointment (when status is `booked`). */
  bookedBy?: ForwardBookingEmployeeRef | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type FetchForwardBookingsParams = {
  practiceId: number;
  /** ISO datetime — hide entries whose booked visit start is before this (default server now). */
  asOf?: string;
  limit?: number;
};

function unwrapList(raw: unknown): ForwardBookingEntry[] {
  if (Array.isArray(raw)) return raw as ForwardBookingEntry[];
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    if (Array.isArray(o.items)) return o.items as ForwardBookingEntry[];
    if (Array.isArray(o.data)) return o.data as ForwardBookingEntry[];
  }
  return [];
}

function unwrapEntry(raw: unknown): ForwardBookingEntry {
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    if (o.entry && typeof o.entry === 'object') return o.entry as ForwardBookingEntry;
    if (o.data && typeof o.data === 'object' && !Array.isArray(o.data))
      return o.data as ForwardBookingEntry;
  }
  return raw as ForwardBookingEntry;
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

export type CreateForwardBookingPayload = {
  practiceId: number;
  sourceAppointmentId: number;
  clientId: number;
  patientId: number;
  monthsOut: number;
  appointmentTypeId?: number;
  primaryProviderId?: number;
  description?: string | null;
  instructions?: string | null;
  serviceMinutes?: number;
  note?: string | null;
  bookingNotes?: string | null;
};

/**
 * POST /forward-bookings — create when staff ends a visit and selects months out.
 */
export async function createForwardBooking(
  body: CreateForwardBookingPayload
): Promise<ForwardBookingEntry> {
  const { data } = await http.post<unknown>('/forward-bookings', body);
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
};

/**
 * PATCH /forward-bookings/:id — update `note` and/or `bookingNotes` (send one or both).
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

// src/api/forwardBookingDisposition.ts
import { http } from './http';
import type { ForwardBookingIntervalUnit } from './forwardBooking';

/** Matches End Visit “How should follow-up be handled?” radio values. */
export type ForwardBookingDispositionMode =
  | 'booked_at_appointment'
  | 'already_booked'
  | 'labs_pending'
  | 'forward_book_fields'
  | 'not_appropriate';

export type ForwardBookingDispositionLabsPendingTask = {
  assignedToEmployeeId?: number | null;
  title?: string | null;
  /** ISO8601 UTC */
  startAt?: string | null;
  /** ISO8601 UTC */
  dueAt?: string | null;
};

/** Draft follow-up choice on the source appointment (before / during End Visit). */
export type ForwardBookingDisposition = {
  mode: ForwardBookingDispositionMode;
  intervalAmount?: number | null;
  intervalUnit?: ForwardBookingIntervalUnit | null;
  bookingNotes?: string | null;
  labsPendingTask?: ForwardBookingDispositionLabsPendingTask | null;
};

export type PatchForwardBookingDispositionPayload = ForwardBookingDisposition;

/** PATCH /appointments/:id/forward-booking-disposition — save staff’s follow-up choice. */
export async function patchForwardBookingDisposition(
  appointmentId: number | string,
  body: PatchForwardBookingDispositionPayload,
  opts?: { practiceId?: number | string }
): Promise<ForwardBookingDisposition> {
  const params =
    opts?.practiceId != null ? { practiceId: String(opts.practiceId) } : undefined;
  const { data } = await http.patch<unknown>(
    `/appointments/${encodeURIComponent(String(appointmentId))}/forward-booking-disposition`,
    body,
    { params }
  );
  if (data && typeof data === 'object') {
    const o = data as Record<string, unknown>;
    if (o.forwardBookingDisposition && typeof o.forwardBookingDisposition === 'object') {
      return o.forwardBookingDisposition as ForwardBookingDisposition;
    }
    if ('mode' in o) return data as ForwardBookingDisposition;
  }
  return body;
}

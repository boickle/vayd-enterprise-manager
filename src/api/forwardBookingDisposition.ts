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

function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function dispositionFromPatchResponse(data: unknown): ForwardBookingDisposition | null {
  if (!data || typeof data !== 'object') return null;
  const o = data as Record<string, unknown>;
  const nested = o.forwardBookingDisposition;
  const src =
    nested && typeof nested === 'object' ? (nested as Record<string, unknown>) : o;
  const mode = src.mode;
  if (typeof mode !== 'string' || !mode.trim()) return null;
  return {
    mode: mode as ForwardBookingDispositionMode,
    intervalAmount:
      typeof src.intervalAmount === 'number' && Number.isFinite(src.intervalAmount)
        ? src.intervalAmount
        : null,
    intervalUnit:
      typeof src.intervalUnit === 'string'
        ? (src.intervalUnit as ForwardBookingIntervalUnit)
        : null,
    bookingNotes: pickStr(src.bookingNotes ?? src.booking_notes ?? src.reason),
    labsPendingTask:
      src.labsPendingTask && typeof src.labsPendingTask === 'object'
        ? (src.labsPendingTask as ForwardBookingDispositionLabsPendingTask)
        : null,
  };
}

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
  const normalized = dispositionFromPatchResponse(data);
  return normalized ?? body;
}

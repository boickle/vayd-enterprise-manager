/**
 * After booking from forward booking → routing, return to the list with optional SMS prompt.
 */
export const FORWARD_BOOKING_RETURN_SESSION_KEY = 'vayd:forward-booking-return-v1';

export type ForwardBookingReturnSessionV1 = {
  v: 1;
  forwardBookingEntryId: number;
  bookedAppointmentId: number;
  bookedAppointmentStart: string;
  bookedAppointmentEnd?: string | null;
  /** Use care outreach SMS copy when auto-opening text after a hold book. */
  smsTemplate?: 'care_outreach' | 'forward_booking';
  /** Pet names for care outreach SMS when multiple patients were booked together. */
  careOutreachPetNames?: string[];
  /** Care outreach SMS uses past-due wording when any booked reminder was overdue. */
  careOutreachAnyPastDue?: boolean;
};

export function readForwardBookingReturnSession(): ForwardBookingReturnSessionV1 | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(FORWARD_BOOKING_RETURN_SESSION_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as ForwardBookingReturnSessionV1;
    if (
      o?.v !== 1 ||
      typeof o.forwardBookingEntryId !== 'number' ||
      typeof o.bookedAppointmentId !== 'number' ||
      !o.bookedAppointmentStart?.trim()
    ) {
      return null;
    }
    return o;
  } catch {
    return null;
  }
}

export function writeForwardBookingReturnSession(
  next: Omit<ForwardBookingReturnSessionV1, 'v'>
): void {
  if (typeof sessionStorage === 'undefined') return;
  const stored: ForwardBookingReturnSessionV1 = { v: 1, ...next };
  try {
    sessionStorage.setItem(FORWARD_BOOKING_RETURN_SESSION_KEY, JSON.stringify(stored));
  } catch {
    /* quota */
  }
}

export function clearForwardBookingReturnSession(): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.removeItem(FORWARD_BOOKING_RETURN_SESSION_KEY);
  } catch {
    /* ignore */
  }
}

export const FORWARD_BOOKING_LIST_PATH = '/schedule/scheduling-tools/forward-booking';
export const ON_HOLD_LIST_PATH = '/schedule/scheduling-tools/on-hold';
export const BOOKED_LIST_PATH = '/schedule/scheduling-tools/booked';
export const COMPLETE_LIST_PATH = '/schedule/scheduling-tools/complete';
export const CARE_OUTREACH_LIST_PATH = '/schedule/scheduling-tools/care-outreach';

export { schedulingWorkflowListPathAfterBook } from '../scheduling-tools-nav';

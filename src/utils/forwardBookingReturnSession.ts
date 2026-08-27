/**
 * After booking from forward booking → routing, return to the list with optional SMS prompt.
 */
import { HOLDS_PATH } from '../holds-nav';
import type { ForwardBookingEntry } from '../api/forwardBooking';
import { forwardBookingLinkedAppointmentId } from './forwardBookingLinkedVisit';

export const FORWARD_BOOKING_RETURN_SESSION_KEY = 'vayd:forward-booking-return-v1';

export type ForwardBookingReturnSessionV1 = {
  v: 1;
  /** When omitted, the list resolves the row by `bookedAppointmentId` after refresh. */
  forwardBookingEntryId?: number;
  bookedAppointmentId: number;
  bookedAppointmentStart: string;
  bookedAppointmentEnd?: string | null;
  /** SMS template when auto-opening text after a routing book. */
  smsTemplate?: 'care_outreach' | 'forward_booking' | 'schedule_loader' | 'waitlist';
  /** Pet names for care outreach SMS when multiple patients were booked together. */
  careOutreachPetNames?: string[];
  /** Care outreach SMS uses past-due wording when any booked reminder was overdue. */
  careOutreachAnyPastDue?: boolean;
  /** Schedule loader post-book SMS (past-due wording). */
  scheduleLoaderPetNames?: string[];
  scheduleLoaderProviderLastName?: string | null;
  scheduleLoaderClientDisplayName?: string | null;
  /** Schedule loader SMS uses past-due care outreach wording when true (default for holds). */
  scheduleLoaderAnyPastDue?: boolean;
  /** Workflow list tab to open after book (from saved appointment type). */
  targetWorkflowTab?: 'onHold' | 'booked';
  /** List the user came from — hold books return here instead of the On hold tab. */
  returnOrigin?: 'forward_booking' | 'care_outreach' | 'schedule_loader' | 'waitlist';
  /** Care outreach client row key for exit animation after hold book. */
  careOutreachClientKey?: string;
  careOutreachClientDisplayName?: string | null;
  careOutreachClientId?: number | null;
  careOutreachClientPhone?: string | null;
  careOutreachClientFirstName?: string | null;
  careOutreachProviderLastName?: string | null;
  /** Household forward-booking rows booked together (multi-pet). */
  forwardBookingEntryIds?: number[];
  /** Pet names for SMS when multiple patients were booked together. */
  forwardBookingPetNames?: string[];
};

export function readForwardBookingReturnSession(): ForwardBookingReturnSessionV1 | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(FORWARD_BOOKING_RETURN_SESSION_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as ForwardBookingReturnSessionV1;
    if (
      o?.v !== 1 ||
      typeof o.bookedAppointmentId !== 'number' ||
      !o.bookedAppointmentStart?.trim()
    ) {
      return null;
    }
    if (
      o.forwardBookingEntryId != null &&
      (!Number.isFinite(Number(o.forwardBookingEntryId)) || Number(o.forwardBookingEntryId) <= 0)
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

export function forwardBookingReturnSessionEntryIds(
  pending: Pick<ForwardBookingReturnSessionV1, 'forwardBookingEntryId' | 'forwardBookingEntryIds'>,
): number[] {
  const fromList = pending.forwardBookingEntryIds
    ?.map((id) => Number(id))
    .filter((id) => Number.isFinite(id) && id > 0);
  if (fromList?.length) return [...new Set(fromList)];
  const single = pending.forwardBookingEntryId;
  if (single != null && Number.isFinite(Number(single)) && Number(single) > 0) {
    return [Number(single)];
  }
  return [];
}

/** Match a return-session row after refresh — by entry id or linked appointment id. */
export function forwardBookingEntryForReturnSession(
  list: readonly ForwardBookingEntry[],
  pending: Pick<ForwardBookingReturnSessionV1, 'forwardBookingEntryId' | 'bookedAppointmentId'>
): ForwardBookingEntry | undefined {
  const entryId = pending.forwardBookingEntryId;
  if (entryId != null && Number.isFinite(Number(entryId)) && Number(entryId) > 0) {
    const byId = list.find((r) => r.id === Number(entryId));
    if (byId) return byId;
  }
  const apptId = pending.bookedAppointmentId;
  if (!Number.isFinite(Number(apptId)) || Number(apptId) <= 0) return undefined;
  return list.find(
    (r) =>
      forwardBookingLinkedAppointmentId(r) === Number(apptId) ||
      r.bookedAppointmentId === Number(apptId)
  );
}

export const FORWARD_BOOKING_LIST_PATH = '/schedule/scheduling-tools/forward-booking';
export const ON_HOLD_LIST_PATH = HOLDS_PATH;
export const BOOKED_LIST_PATH = '/schedule/scheduling-tools/booked';
export const COMPLETE_LIST_PATH = '/schedule/scheduling-tools/complete';
export const CARE_OUTREACH_LIST_PATH = '/schedule/scheduling-tools/care-outreach';

export { schedulingWorkflowListPathAfterBook, schedulingReturnPathAfterBook } from '../scheduling-tools-nav';

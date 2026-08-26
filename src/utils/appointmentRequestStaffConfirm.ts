import type { AppointmentRequestSubmissionItem } from '../api/appointmentRequestSubmissions';
import { requestDataSelfScheduledSlot } from './appointmentRequestDisplay';

/** Client self-scheduled online and the system linked a calendar visit. */
export function appointmentRequestAutoBookedOnline(
  item: AppointmentRequestSubmissionItem,
): boolean {
  const rd = item.requestData ?? {};
  return (
    (item.status ?? 'new') === 'booked' &&
    item.bookedAppointmentId != null &&
    !!item.bookedAt &&
    requestDataSelfScheduledSlot(rd) != null
  );
}

/** Auto-booked online visit waiting for client-liaison review. */
export function appointmentRequestNeedsStaffConfirmation(
  item: AppointmentRequestSubmissionItem,
): boolean {
  return appointmentRequestAutoBookedOnline(item) && !item.staffConfirmedAt?.trim();
}

/**
 * Manual Book / Link appointment actions are only for requests that still need
 * scheduling. Online auto-books awaiting liaison Confirm must not use those
 * buttons — including while `bookedApptMeta` is still hydrating (so
 * `hasLinkedAppointment` is temporarily false).
 */
export function appointmentRequestNeedsManualBookActions(args: {
  item: AppointmentRequestSubmissionItem;
  isDismissed: boolean;
  isBooked: boolean;
  hasLinkedAppointment: boolean;
}): boolean {
  if (appointmentRequestNeedsStaffConfirmation(args.item)) return false;
  return !args.isDismissed && !args.isBooked && !args.hasLinkedAppointment;
}

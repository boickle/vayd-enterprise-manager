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
 * Whether Scout list actions should show Confirm (not Book / Link appointment).
 *
 * Auto-booked submissions already carry `bookedAppointmentId` + a self-scheduled
 * slot. Do not gate this on `bookedApptMeta` hydration — waiting caused the
 * Auto-Booked tab to flash Book / Link appointment until the calendar summary
 * loaded.
 */
export function appointmentRequestShouldShowConfirmAction(
  item: AppointmentRequestSubmissionItem,
): boolean {
  return appointmentRequestNeedsStaffConfirmation(item);
}

/** Book / Link appointment CTAs — never for auto-booked rows awaiting Confirm. */
export function appointmentRequestNeedsManualBookActions(args: {
  item: AppointmentRequestSubmissionItem;
  isDismissed: boolean;
  isBooked: boolean;
  hasLinkedAppointment: boolean;
}): boolean {
  if (args.isDismissed || args.isBooked || args.hasLinkedAppointment) return false;
  if (appointmentRequestShouldShowConfirmAction(args.item)) return false;
  return true;
}

/**
 * Confirm / View / Reschedule action cluster (vs Reopen for dismissed-only rows).
 * Includes auto-booked pending confirmation even before meta hydration.
 */
export function appointmentRequestShowsLinkedVisitActions(args: {
  item: AppointmentRequestSubmissionItem;
  isBooked: boolean;
  hasLinkedAppointment: boolean;
}): boolean {
  return (
    args.isBooked ||
    args.hasLinkedAppointment ||
    appointmentRequestShouldShowConfirmAction(args.item)
  );
}

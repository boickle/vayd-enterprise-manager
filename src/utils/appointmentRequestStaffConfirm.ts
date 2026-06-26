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

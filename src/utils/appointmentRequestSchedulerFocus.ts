import { DateTime } from 'luxon';
import type { AppointmentRequestSubmissionItem } from '../api/appointmentRequestSubmissions';
import { requestDataSelfScheduledSlot } from './appointmentRequestDisplay';
import type { AppointmentRequestBookedApptSummary } from './appointmentRequestOnHold';

/** Practice-local date + provider hints for scheduler focus deep links. */
export function appointmentRequestSchedulerViewHints(
  item: AppointmentRequestSubmissionItem,
  bookedSummary: AppointmentRequestBookedApptSummary | null | undefined,
  practiceTz: string,
): { dateKey: string | null; providerId: string | undefined } {
  const rd = item.requestData ?? {};
  const start =
    bookedSummary?.start?.trim() ||
    requestDataSelfScheduledSlot(rd)?.appointmentStart?.trim() ||
    null;
  const dateKey = start
    ? DateTime.fromISO(start, { zone: 'utc' }).setZone(practiceTz).toISODate()
    : null;
  const providerId = bookedSummary?.providerInternalId?.trim() || undefined;
  return { dateKey, providerId };
}

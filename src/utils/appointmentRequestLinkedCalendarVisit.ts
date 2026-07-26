import { isAppointmentCancelledOnPracticeCalendar } from '../api/appointments';
import type { AppointmentRequestSubmissionItem } from '../api/appointmentRequestSubmissions';
import type { Appointment } from '../api/roomLoader';
import type { AppointmentRequestBookedApptSummary } from './appointmentRequestOnHold';

/** Linked calendar row is still on the practice schedule (not cancelled / removed). */
export function appointmentRequestBookedSummaryIsActive(
  summary: AppointmentRequestBookedApptSummary | null | undefined,
): boolean {
  if (!summary?.start?.trim()) return false;
  return !summary.appointmentCancelled;
}

/**
 * A newly submitted request cannot legitimately be linked to a visit that
 * started before the request existed. Treat that as a stale/wrong association.
 */
export function appointmentRequestBookedSummaryMatchesSubmission(
  item: AppointmentRequestSubmissionItem,
  summary: AppointmentRequestBookedApptSummary | null | undefined,
): boolean {
  if (!appointmentRequestBookedSummaryIsActive(summary)) return false;
  const visitStart = Date.parse(summary!.start);
  const submittedAt = Date.parse(item.submittedAt || item.created);
  if (!Number.isFinite(visitStart) || !Number.isFinite(submittedAt)) return false;
  return visitStart >= submittedAt;
}

export function appointmentRequestSubmissionHasActiveLinkedVisit(
  item: AppointmentRequestSubmissionItem,
  bookedApptMeta: ReadonlyMap<number, AppointmentRequestBookedApptSummary>,
): boolean {
  const apptId = item.bookedAppointmentId;
  if (apptId == null || !Number.isFinite(Number(apptId))) return false;
  const summary = bookedApptMeta.get(Number(apptId));
  // Missing meta: do not assume the visit is still on the calendar (stale/deleted holds
  // used to force the scheduler path and strand Not booked when GET /appointments/:id 404s).
  if (!summary) return false;
  return appointmentRequestBookedSummaryMatchesSubmission(item, summary);
}

export function appointmentRecordHasActiveLinkedVisit(
  appt: Appointment | null | undefined,
): boolean {
  if (!appt) return false;
  return !isAppointmentCancelledOnPracticeCalendar(appt);
}

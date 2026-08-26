import { bookAppointmentRequestSubmission } from '../api/appointmentRequestSubmissions';
import type { SchedulerBookPrefill } from '../pages/SchedulerBookModal';

export type AppointmentRequestBookCompleteResult = {
  completed: boolean;
  error?: string;
};

/** After a successful routing book, link the new appointment to the appointment request submission. */
export async function completeAppointmentRequestFromBook(
  appointmentId: number,
  prefill: SchedulerBookPrefill | null | undefined
): Promise<AppointmentRequestBookCompleteResult> {
  const submissionId = prefill?.appointmentRequestSubmissionId;
  if (submissionId == null || !Number.isFinite(Number(submissionId))) {
    return { completed: false };
  }
  try {
    await bookAppointmentRequestSubmission(Number(submissionId), { appointmentId });
    return { completed: true };
  } catch (e: unknown) {
    const ax = e as { response?: { data?: { message?: string } }; message?: string };
    const msg =
      ax?.response?.data?.message ??
      ax?.message ??
      'Could not link the appointment to this request.';
    return { completed: false, error: String(msg) };
  }
}

import { completeForwardBooking } from '../api/forwardBooking';
import type { SchedulerBookPrefill } from '../pages/SchedulerBookModal';

export type ForwardBookingBookCompleteResult = {
  completed: boolean;
  error?: string;
};

/** After a successful routing book, link the new appointment to the forward booking entry. */
export async function completeForwardBookingFromBook(
  appointmentId: number,
  prefill: SchedulerBookPrefill | null | undefined
): Promise<ForwardBookingBookCompleteResult> {
  const entryId = prefill?.forwardBookingEntryId;
  const token = prefill?.forwardBookingTrackingToken?.trim();
  if (entryId == null || !Number.isFinite(Number(entryId)) || !token) {
    return { completed: false };
  }
  try {
    await completeForwardBooking(Number(entryId), {
      trackingToken: token,
      appointmentId,
      completedVia: 'routing',
    });
    return { completed: true };
  } catch (e: unknown) {
    const ax = e as { response?: { data?: { message?: string } }; message?: string };
    const msg = ax?.response?.data?.message ?? ax?.message ?? 'Could not mark forward booking complete.';
    return { completed: false, error: String(msg) };
  }
}

import { completeForwardBooking, type ForwardBookingEntry } from '../api/forwardBooking';
import type { SchedulerBookPrefill } from '../pages/SchedulerBookModal';
import { forwardBookingLinkedAppointmentId } from './forwardBookingLinkedVisit';

export type ForwardBookingBookCompleteResult = {
  completed: boolean;
  error?: string;
};

export type ForwardBookingVisitComplete = {
  forwardBookingEntryId: number;
  forwardBookingTrackingToken: string;
  patientId: string;
};

/** After a successful routing book, link the new appointment to the forward booking entry. */
export async function completeForwardBookingFromBook(
  appointmentId: number,
  prefill: SchedulerBookPrefill | null | undefined,
  opts?: { patientId?: string }
): Promise<ForwardBookingBookCompleteResult> {
  const completes = prefill?.forwardBookingVisitCompletes;
  const patientKey = opts?.patientId?.trim();
  const matched =
    patientKey && completes?.length
      ? completes.find((row) => row.patientId.trim() === patientKey)
      : undefined;
  const entryId = matched?.forwardBookingEntryId ?? prefill?.forwardBookingEntryId;
  const token = matched?.forwardBookingTrackingToken?.trim() ?? prefill?.forwardBookingTrackingToken?.trim();
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

export async function completeAllForwardBookingVisitsFromBook(
  createdByPatientId: Map<string, number>,
  prefill: SchedulerBookPrefill | null | undefined
): Promise<{ warnings: string[] }> {
  const warnings: string[] = [];
  const rows = prefill?.forwardBookingVisitCompletes;
  if (!rows?.length) {
    if (prefill?.forwardBookingEntryId != null) {
      const firstId = createdByPatientId.values().next().value;
      if (firstId != null) {
        const result = await completeForwardBookingFromBook(firstId, prefill);
        if (!result.completed && result.error) warnings.push(result.error);
      }
    }
    return { warnings };
  }
  for (const row of rows) {
    const apptId = createdByPatientId.get(row.patientId.trim());
    if (apptId == null) continue;
    const result = await completeForwardBookingFromBook(apptId, prefill, {
      patientId: row.patientId,
    });
    if (!result.completed && result.error) {
      const label = row.patientName?.trim() || `Pet ${row.patientId}`;
      warnings.push(`${label}: ${result.error}`);
    }
  }
  return { warnings };
}

/** Persist a locally linked calendar visit on the server before follow-up PATCH complete. */
export async function ensureForwardBookingServerLink(
  entry: ForwardBookingEntry
): Promise<ForwardBookingEntry> {
  const apptId = forwardBookingLinkedAppointmentId(entry);
  if (apptId == null) return entry;
  // Local sessionStorage merge can set bookedAppointment* while server status is still pending.
  if (entry.status === 'booked' || entry.status === 'complete') {
    return entry;
  }
  return completeForwardBooking(entry.id, {
    appointmentId: apptId,
    completedVia: 'manual',
  });
}

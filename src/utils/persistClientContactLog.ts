import { patchReminderOutreachNotes } from '../api/careOutreach';
import { patchAppointmentRequestSubmission } from '../api/appointmentRequestSubmissions';
import { patchForwardBooking } from '../api/forwardBooking';
import type { ContactLogWriteTarget } from './clientContactLog';

const PRACTICE_ID = Number(import.meta.env.VITE_PRACTICE_ID) || 1;

function noteForPatch(value: string): string | null {
  const trimmed = value.trim();
  return trimmed || null;
}

/** Persist staff contact log to the canonical store for this workflow. */
export async function persistClientContactLog(args: {
  target: ContactLogWriteTarget;
  text: string;
  reminderIds?: readonly number[];
  forwardBookingId?: number;
  submissionId?: number;
  /** When true (default for reminder_outreach), also mirror to forward booking `note`. */
  syncForwardBookingId?: number;
}): Promise<void> {
  const { target, text, reminderIds = [], forwardBookingId, submissionId, syncForwardBookingId } =
    args;
  const patched = noteForPatch(text);

  if (target === 'reminder_outreach') {
    await Promise.all(
      reminderIds.map((id) => patchReminderOutreachNotes(id, patched ?? '')),
    );
    const fbId = syncForwardBookingId ?? forwardBookingId;
    if (fbId != null) {
      await patchForwardBooking(fbId, { practiceId: PRACTICE_ID, note: patched });
    }
    return;
  }

  if (target === 'forward_booking_note') {
    if (forwardBookingId == null) {
      throw new Error('Missing forward booking id for contact log save.');
    }
    await patchForwardBooking(forwardBookingId, { practiceId: PRACTICE_ID, note: patched });
    return;
  }

  if (target === 'appointment_request_notes') {
    if (submissionId == null) {
      throw new Error('Missing submission id for contact log save.');
    }
    await patchAppointmentRequestSubmission(submissionId, { notes: patched });
  }
}

import type { NavigateFunction } from 'react-router-dom';
import { fetchAppointmentById } from '../api/appointments';
import type { AppointmentRequestSubmissionItem } from '../api/appointmentRequestSubmissions';
import { clientDisplayNameFromRequestData } from './appointmentRequestDisplay';
import { appointmentRecordHasActiveLinkedVisit } from './appointmentRequestLinkedCalendarVisit';
import type { AppointmentRequestBookedApptSummary } from './appointmentRequestOnHold';
import { writeNotBookedRemoveSession } from './appointmentRequestNotBookedRemoveSession';
import { appointmentRequestSchedulerViewHints } from './appointmentRequestSchedulerFocus';
import {
  buildSchedulerFocusAppointmentUrl,
  writeSchedulerFocusSession,
  writeSchedulerFocusReturnSession,
} from './schedulerFocusAppointment';

const PRACTICE_ID = Number(import.meta.env.VITE_PRACTICE_ID) || 1;

export type BeginNotBookedFlowResult =
  | { kind: 'scheduler_remove' }
  | { kind: 'needs_reason' }
  | { kind: 'already_dismissed' };

/** Shared Not booked entry — Scout list, Gmail panel, or Gmail NOT BOOKED label. */
export async function beginAppointmentRequestNotBookedFlow(args: {
  submission: AppointmentRequestSubmissionItem;
  returnPath: string;
  practiceTz: string;
  navigate: NavigateFunction;
  mailbox?: string;
  threadId?: string;
  bookedApptSummary?: AppointmentRequestBookedApptSummary | null;
}): Promise<BeginNotBookedFlowResult> {
  const { submission, returnPath, practiceTz, navigate, mailbox, threadId, bookedApptSummary } =
    args;

  if ((submission.status ?? 'new') === 'dismissed') {
    return { kind: 'already_dismissed' };
  }

  const apptId = submission.bookedAppointmentId;
  if (apptId != null) {
    const appt = await fetchAppointmentById(Number(apptId), { practiceId: PRACTICE_ID });
    if (appointmentRecordHasActiveLinkedVisit(appt)) {
      const { dateKey, providerId } = appointmentRequestSchedulerViewHints(
        submission,
        bookedApptSummary ?? null,
        practiceTz,
      );
      writeNotBookedRemoveSession({
        submissionId: submission.id,
        bookedAppointmentId: Number(apptId),
        clientLabel: clientDisplayNameFromRequestData(submission.requestData ?? {}),
        returnPath,
      });
      if (mailbox?.trim() && threadId?.trim()) {
        writeSchedulerFocusReturnSession(mailbox.trim(), threadId.trim());
      }
      writeSchedulerFocusSession({
        appointmentId: Number(apptId),
        dateHint: dateKey,
        providerHint: providerId ?? null,
      });
      navigate(
        buildSchedulerFocusAppointmentUrl(Number(apptId), {
          date: dateKey ?? undefined,
          providerId,
        }),
      );
      return { kind: 'scheduler_remove' };
    }
  }

  return { kind: 'needs_reason' };
}

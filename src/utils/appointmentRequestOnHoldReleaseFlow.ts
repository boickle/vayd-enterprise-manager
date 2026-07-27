import type { NavigateFunction } from 'react-router';
import { fetchAppointmentById } from '../api/appointments';
import type { AppointmentRequestSubmissionItem } from '../api/appointmentRequestSubmissions';
import { clientDisplayNameFromRequestData } from './appointmentRequestDisplay';
import { appointmentRecordHasActiveLinkedVisit } from './appointmentRequestLinkedCalendarVisit';
import {
  appointmentRequestSubmissionIsOnHold,
  type AppointmentRequestBookedApptSummary,
} from './appointmentRequestOnHold';
import { appointmentRequestSchedulerViewHints } from './appointmentRequestSchedulerFocus';
import { writeOnHoldVisitEditSession } from './onHoldVisitEditSession';
import type { AppointmentTypeCatalog } from './appointmentTypeSettings';
import {
  buildSchedulerFocusAppointmentUrl,
  writeSchedulerFocusSession,
  writeSchedulerFocusReturnSession,
} from './schedulerFocusAppointment';

const PRACTICE_ID = Number(import.meta.env.VITE_PRACTICE_ID) || 1;

export type BeginOnHoldReleaseFlowResult =
  | { kind: 'scheduler_edit' }
  | { kind: 'allow_remove' };

/**
 * Before removing the ON HOLD Gmail label, ensure the linked calendar hold is gone
 * (removed or converted to a real appointment). Otherwise send staff to the scheduler.
 */
export async function beginAppointmentRequestOnHoldReleaseFlow(args: {
  submission: AppointmentRequestSubmissionItem;
  returnPath: string;
  practiceTz: string;
  navigate: NavigateFunction;
  mailbox?: string;
  threadId?: string;
  bookedApptSummary?: AppointmentRequestBookedApptSummary | null;
  bookedApptMeta?: ReadonlyMap<number, AppointmentRequestBookedApptSummary>;
  typeCatalog?: AppointmentTypeCatalog | null;
}): Promise<BeginOnHoldReleaseFlowResult> {
  const {
    submission,
    returnPath,
    practiceTz,
    navigate,
    mailbox,
    threadId,
    bookedApptSummary,
    bookedApptMeta,
    typeCatalog,
  } = args;

  const meta = bookedApptMeta ?? new Map<number, AppointmentRequestBookedApptSummary>();
  if (!appointmentRequestSubmissionIsOnHold(submission, meta, typeCatalog ?? null)) {
    return { kind: 'allow_remove' };
  }

  const apptId = submission.bookedAppointmentId;
  if (apptId == null) {
    return { kind: 'allow_remove' };
  }

  const appt = await fetchAppointmentById(Number(apptId), { practiceId: PRACTICE_ID });
  if (!appointmentRecordHasActiveLinkedVisit(appt)) {
    return { kind: 'allow_remove' };
  }

  const summary =
    bookedApptSummary ?? meta.get(Number(apptId)) ?? null;
  const { dateKey, providerId } = appointmentRequestSchedulerViewHints(
    submission,
    summary,
    practiceTz,
  );

  writeOnHoldVisitEditSession({
    listEntryId: submission.id,
    listKind: 'appointment_request',
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
  return { kind: 'scheduler_edit' };
}

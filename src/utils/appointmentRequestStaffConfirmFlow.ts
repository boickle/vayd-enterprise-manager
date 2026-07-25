import type { NavigateFunction } from 'react-router';
import { DateTime } from 'luxon';
import {
  fetchAppointmentById,
  fetchAppointmentsRange,
  isAppointmentCancelledOnPracticeCalendar,
} from '../api/appointments';
import type { AppointmentRequestSubmissionItem } from '../api/appointmentRequestSubmissions';
import type { Appointment } from '../api/roomLoader';
import {
  clientDisplayNameFromRequestData,
  requestDataClientType,
  requestDataRequestedStartIso,
} from './appointmentRequestDisplay';
import type { AppointmentRequestBookedApptSummary } from './appointmentRequestOnHold';
import { appointmentRequestNeedsStaffConfirmation } from './appointmentRequestStaffConfirm';
import { writeAppointmentRequestStaffConfirmSession } from './appointmentRequestStaffConfirmSession';
import { appointmentRequestSchedulerViewHints } from './appointmentRequestSchedulerFocus';
import { fetchAppointmentRequestLinkCandidates } from './appointmentRequestLinkCandidates';
import { opsPointsForAppointment } from './forwardBookingListVisibility';
import type { AppointmentTypeCatalog } from './appointmentTypeSettings';
import { submissionIdFromOnlineHoldPimsId } from './holdsOpenInScheduler';
import {
  buildSchedulerFocusAppointmentUrl,
  writeSchedulerFocusSession,
  writeSchedulerFocusReturnSession,
} from './schedulerFocusAppointment';

const PRACTICE_ID = Number(import.meta.env.VITE_PRACTICE_ID) || 1;

export type BeginStaffConfirmFlowResult =
  /** Linked visit found — open the calendar staff-confirm review flow. */
  | { kind: 'scheduler_review' }
  /** Linked id stale/moved outside Auto-Booked — staff pick the visit to track. */
  | { kind: 'needs_relink' }
  /** Linked visit is gone and no replacement found — use Not booked, not Confirm. */
  | { kind: 'needs_not_booked' }
  | { kind: 'already_confirmed' }
  | { kind: 'error'; message: string };

function appointmentStillNeedsCalendarReview(
  appt: Appointment,
  typeCatalog: AppointmentTypeCatalog | null | undefined,
): boolean {
  if (isAppointmentCancelledOnPracticeCalendar(appt)) return false;
  if (typeCatalog) {
    return opsPointsForAppointment(appt, typeCatalog) <= 0;
  }
  const at = appt.appointmentType;
  if (at && typeof at === 'object') {
    const holdFlag = (at as { isHold?: unknown }).isHold;
    if (holdFlag === true || holdFlag === 1 || holdFlag === '1' || holdFlag === 'true') {
      return true;
    }
    const name = String(
      (at as { name?: unknown; prettyName?: unknown }).name ??
        (at as { prettyName?: unknown }).prettyName ??
        '',
    )
      .trim()
      .toUpperCase();
    if (name === 'HOLD' || name.includes('HOLD FOR')) return true;
  }
  return false;
}

function linkableAppointment(a: Appointment): boolean {
  if ((a as { isDeleted?: boolean }).isDeleted) return false;
  if (a.isActive === false) return false;
  if (isAppointmentCancelledOnPracticeCalendar(a)) return false;
  return Boolean(a.appointmentStart?.trim());
}

function mergeById(...lists: Appointment[][]): Appointment[] {
  const byId = new Map<number, Appointment>();
  for (const list of lists) {
    for (const a of list) {
      const id = Number(a.id);
      if (Number.isFinite(id) && id > 0) byId.set(id, a);
    }
  }
  return [...byId.values()];
}

/** Prefer the live calendar visit for this online request (same hold pimsId, else client matches). */
export async function findAppointmentRequestConfirmLinkTarget(args: {
  submission: AppointmentRequestSubmissionItem;
  practiceTz: string;
  typeCatalog?: AppointmentTypeCatalog | null;
}): Promise<
  | { kind: 'linked'; appointment: Appointment; needsReview: boolean }
  | { kind: 'replacement'; appointment: Appointment }
  | { kind: 'ambiguous' }
  | { kind: 'missing' }
> {
  const { submission, practiceTz, typeCatalog } = args;
  const linkedId = submission.bookedAppointmentId;
  const linked =
    linkedId != null && Number.isFinite(Number(linkedId))
      ? await fetchAppointmentById(Number(linkedId), { practiceId: PRACTICE_ID })
      : null;

  if (linked && linkableAppointment(linked)) {
    return {
      kind: 'linked',
      appointment: linked,
      needsReview: appointmentStillNeedsCalendarReview(linked, typeCatalog),
    };
  }

  const rd = submission.requestData ?? {};
  const { appointments: clientCandidates } = await fetchAppointmentRequestLinkCandidates({
    requestData: rd,
    practiceId: PRACTICE_ID,
    practiceTz,
  });

  let holdTagged: Appointment[] = [];
  try {
    const requestedStart = requestDataRequestedStartIso(rd);
    const anchor = requestedStart
      ? DateTime.fromISO(requestedStart, { zone: 'utc' }).setZone(practiceTz)
      : DateTime.now().setZone(practiceTz);
    const start = (anchor.isValid ? anchor : DateTime.now().setZone(practiceTz))
      .minus({ days: 14 })
      .startOf('day')
      .toUTC()
      .toISO()!;
    const end = (anchor.isValid ? anchor : DateTime.now().setZone(practiceTz))
      .plus({ days: 90 })
      .endOf('day')
      .toUTC()
      .toISO()!;
    const rangeRows = await fetchAppointmentsRange({
      practiceId: PRACTICE_ID,
      start,
      end,
    });
    holdTagged = rangeRows.filter(
      (a) =>
        linkableAppointment(a) &&
        submissionIdFromOnlineHoldPimsId((a as { pimsId?: string | null }).pimsId) ===
          submission.id,
    );
  } catch {
    /* range scan is best-effort */
  }

  const pool = mergeById(holdTagged, clientCandidates).filter(linkableAppointment);
  if (pool.length === 0) return { kind: 'missing' };

  const byHoldPims = pool.filter(
    (a) =>
      submissionIdFromOnlineHoldPimsId((a as { pimsId?: string | null }).pimsId) ===
      submission.id,
  );
  const prefer = byHoldPims.length > 0 ? byHoldPims : pool;
  const realVisits = prefer.filter((a) => !appointmentStillNeedsCalendarReview(a, typeCatalog));
  const shortlist = realVisits.length > 0 ? realVisits : prefer;

  if (shortlist.length === 1) {
    const only = shortlist[0]!;
    const id = Number(only.id);
    if (linkedId != null && Number(linkedId) === id) {
      return {
        kind: 'linked',
        appointment: only,
        needsReview: appointmentStillNeedsCalendarReview(only, typeCatalog),
      };
    }
    return { kind: 'replacement', appointment: only };
  }

  return { kind: 'ambiguous' };
}

/**
 * Confirm an auto-booked request.
 *
 * - Linked visit still on the calendar → open the calendar staff-confirm flow
 *   (highlight the visit), whether it is still a HOLD or already a real type.
 * - Linked id is stale/moved outside Auto-Booked → ask to re-link.
 * - Nothing on the calendar → refuse Confirm (use Not booked).
 */
export async function beginAppointmentRequestStaffConfirmFlow(args: {
  submission: AppointmentRequestSubmissionItem;
  practiceTz: string;
  navigate: NavigateFunction;
  typeCatalog?: AppointmentTypeCatalog | null;
  bookedApptSummary?: AppointmentRequestBookedApptSummary | null;
  returnPath?: string | null;
  mailbox?: string;
  threadId?: string;
}): Promise<BeginStaffConfirmFlowResult> {
  const {
    submission,
    practiceTz,
    navigate,
    typeCatalog,
    bookedApptSummary,
    returnPath,
    mailbox,
    threadId,
  } = args;

  if (!appointmentRequestNeedsStaffConfirmation(submission)) {
    return { kind: 'already_confirmed' };
  }

  const apptId = submission.bookedAppointmentId;
  if (apptId == null || !Number.isFinite(Number(apptId))) {
    return { kind: 'error', message: 'This request has no linked calendar visit to confirm.' };
  }

  const resolved = await findAppointmentRequestConfirmLinkTarget({
    submission,
    practiceTz,
    typeCatalog,
  });

  // Known linked visit (HOLD or already converted) — same as before: go to the calendar.
  if (resolved.kind === 'linked') {
    const focusId = Number(resolved.appointment.id);
    const { dateKey, providerId } = appointmentRequestSchedulerViewHints(
      submission,
      bookedApptSummary ?? null,
      practiceTz,
    );
    writeAppointmentRequestStaffConfirmSession({
      submissionId: submission.id,
      bookedAppointmentId: focusId,
      clientLabel: clientDisplayNameFromRequestData(submission.requestData ?? {}),
      isNewClient: requestDataClientType(submission.requestData ?? {}) === 'new',
      ...(returnPath?.trim() ? { returnPath: returnPath.trim() } : {}),
    });
    if (mailbox?.trim() && threadId?.trim()) {
      writeSchedulerFocusReturnSession(mailbox.trim(), threadId.trim());
    }
    writeSchedulerFocusSession({
      appointmentId: focusId,
      dateHint: dateKey,
      providerHint: providerId ?? null,
    });
    navigate(
      buildSchedulerFocusAppointmentUrl(focusId, {
        date: dateKey ?? undefined,
        providerId,
      }),
    );
    return { kind: 'scheduler_review' };
  }

  // Original link stale/moved outside Auto-Booked — staff pick the visit to track.
  if (resolved.kind === 'replacement' || resolved.kind === 'ambiguous') {
    return { kind: 'needs_relink' };
  }

  // Nothing on the calendar — staff should mark Not booked instead of confirming.
  return { kind: 'needs_not_booked' };
}

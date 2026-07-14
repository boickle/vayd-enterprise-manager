import type { NavigateFunction } from 'react-router-dom';
import { DateTime } from 'luxon';
import type { HoldListItem } from '../api/holds';
import { fetchAppointmentById } from '../api/appointments';
import { fetchAppointmentRequestSubmission } from '../api/appointmentRequestSubmissions';
import {
  buildRoutingRescheduleIntentFromAppointment,
  writeRoutingRescheduleIntent,
} from './routingRescheduleIntent';
import { fetchAndCacheRescheduleSourcePlacementSnapshot } from './routingRescheduleScoreCompare';
import { writeSchedulerCalendarHandoff } from './schedulerCalendarHandoff';
import {
  clientDisplayNameFromRequestData,
  requestDataClientType,
} from './appointmentRequestDisplay';
import { appointmentRequestNeedsStaffConfirmation } from './appointmentRequestStaffConfirm';
import { writeAppointmentRequestStaffConfirmSession } from './appointmentRequestStaffConfirmSession';
import { resolveHoldClientLabel } from './holdsDisplay';
import {
  writeOnHoldVisitEditSession,
  type OnHoldVisitEditFlowIntent,
} from './onHoldVisitEditSession';
import { writeHoldsBoardDepartSession } from './holdsBoardDepartSession';
import {
  buildSchedulerFocusAppointmentUrl,
  writeSchedulerFocusSession,
} from './schedulerFocusAppointment';
import type { HoldVisitSlotGroup } from './holdsHousehold';

/** Parse submission id from online-submission-hold pimsIds when the API row omits it. */
export function submissionIdFromOnlineHoldPimsId(
  pimsId: string | null | undefined
): number | null {
  if (typeof pimsId !== 'string' || !pimsId.startsWith('online-submission-hold:')) {
    return null;
  }
  const id = Number(pimsId.split(':')[1]);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export function resolveHoldSubmissionId(hold: HoldListItem): number | null {
  if (hold.appointmentRequestSubmissionId != null) {
    return hold.appointmentRequestSubmissionId;
  }
  return submissionIdFromOnlineHoldPimsId(hold.pimsId);
}

function focusHoldOnScheduler(
  hold: HoldListItem,
  navigate: NavigateFunction,
  practiceTz: string,
  groupKey?: string | null,
): void {
  if (typeof window !== 'undefined') {
    writeHoldsBoardDepartSession({
      scrollY: window.scrollY,
      groupKey: groupKey ?? null,
    });
  }
  const dateKey = hold.appointmentStart
    ? DateTime.fromISO(hold.appointmentStart, { zone: 'utc' })
        .setZone(practiceTz)
        .toISODate()
    : null;
  const providerId =
    hold.primaryProvider?.id != null ? String(hold.primaryProvider.id) : undefined;

  writeSchedulerFocusSession({
    appointmentId: hold.id,
    dateHint: dateKey,
    providerHint: providerId ?? null,
  });

  navigate(
    buildSchedulerFocusAppointmentUrl(hold.id, {
      date: dateKey ?? undefined,
      providerId,
    }),
  );
}

async function writeHoldReviewSchedulerSession(args: {
  hold: HoldListItem;
  returnPath: string;
  groupKey?: string | null;
  flowIntent?: OnHoldVisitEditFlowIntent;
  removeAppointmentIds?: number[];
}): Promise<void> {
  const { hold, returnPath, groupKey, flowIntent = 'review', removeAppointmentIds } = args;
  const clientLabel = resolveHoldClientLabel(hold);
  const submissionId = resolveHoldSubmissionId(hold);
  const sessionExtras = {
    bookedAppointmentId: hold.id,
    clientLabel,
    returnPath,
    groupKey: groupKey?.trim() || null,
    flowIntent,
    ...(removeAppointmentIds && removeAppointmentIds.length > 0
      ? { removeAppointmentIds }
      : {}),
  };

  if (hold.forwardBooking) {
    writeOnHoldVisitEditSession({
      ...sessionExtras,
      listEntryId: hold.forwardBooking.id,
      listKind: 'forward_booking',
    });
    return;
  }

  if (submissionId != null) {
    if (flowIntent === 'remove') {
      writeOnHoldVisitEditSession({
        ...sessionExtras,
        listEntryId: submissionId,
        listKind: 'appointment_request',
      });
      return;
    }
    let requestData: Record<string, unknown> = {};
    try {
      const submission = await fetchAppointmentRequestSubmission(submissionId);
      requestData = submission.requestData ?? {};
      const label =
        clientDisplayNameFromRequestData(requestData).trim() || clientLabel;

      if (appointmentRequestNeedsStaffConfirmation(submission)) {
        writeAppointmentRequestStaffConfirmSession({
          submissionId,
          bookedAppointmentId: hold.id,
          clientLabel: label,
          isNewClient: requestDataClientType(requestData) === 'new',
          returnPath,
        });
        return;
      }
      writeOnHoldVisitEditSession({
        ...sessionExtras,
        listEntryId: submissionId,
        listKind: 'appointment_request',
      });
      return;
    } catch {
      writeOnHoldVisitEditSession({
        ...sessionExtras,
        listEntryId: submissionId,
        listKind: 'appointment_request',
      });
      return;
    }
  }

  writeOnHoldVisitEditSession({
    ...sessionExtras,
    listEntryId: hold.id,
    listKind: 'forward_booking',
  });
}

/**
 * Navigate to the scheduler and open the correct preview flow for a hold:
 * staff confirm for unconfirmed online bookings, on-hold edit otherwise.
 */
export async function beginHoldOpenInScheduler(args: {
  hold: HoldListItem;
  navigate: NavigateFunction;
  practiceTz: string;
  returnPath: string;
  /** Household row key — restored for scroll + exit animation on return. */
  groupKey?: string | null;
}): Promise<void> {
  const { hold, navigate, practiceTz, returnPath, groupKey } = args;
  await writeHoldReviewSchedulerSession({ hold, returnPath, groupKey, flowIntent: 'review' });
  focusHoldOnScheduler(hold, navigate, practiceTz, groupKey);
}

/** Holds board → calendar remove flow with highlighted hold and reason prompt. */
export async function beginHoldRemoveInScheduler(args: {
  slot: HoldVisitSlotGroup;
  navigate: NavigateFunction;
  practiceTz: string;
  returnPath: string;
  groupKey?: string | null;
}): Promise<void> {
  const { slot, navigate, practiceTz, returnPath, groupKey } = args;
  const anchor = slot.anchor;
  const removeAppointmentIds = slot.holds
    .map((h) => h.id)
    .filter((id) => Number.isFinite(id) && id > 0);
  await writeHoldReviewSchedulerSession({
    hold: anchor,
    returnPath,
    groupKey,
    flowIntent: 'remove',
    removeAppointmentIds,
  });
  focusHoldOnScheduler(anchor, navigate, practiceTz, groupKey);
}

export type BeginHoldRescheduleResult =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Holds board → routing reschedule flow. Loads the hold's calendar appointment,
 * writes the routing reschedule intent + calendar handoff, then navigates to
 * `/schedule/routing` (same path the scheduler uses for reschedule).
 */
export async function beginHoldReschedule(args: {
  hold: HoldListItem;
  navigate: NavigateFunction;
  practiceTz: string;
  practiceId: number;
  /** Where "Dismiss" in the reschedule workspace should return (the Holds board). */
  returnPath?: string;
}): Promise<BeginHoldRescheduleResult> {
  const { hold, navigate, practiceTz, practiceId, returnPath } = args;
  const appt = await fetchAppointmentById(hold.id, { practiceId });
  if (!appt) {
    return { ok: false, reason: 'Could not load this hold to reschedule.' };
  }
  const intent = buildRoutingRescheduleIntentFromAppointment(appt, {
    practiceTz,
    allowAddressOnly: true,
  });
  if (!intent) {
    return {
      ok: false,
      reason: 'This hold cannot be rescheduled (needs a linked client or a visit address).',
    };
  }
  writeRoutingRescheduleIntent({
    ...intent,
    ...(returnPath?.trim() ? { returnPath: returnPath.trim() } : {}),
  });
  void fetchAndCacheRescheduleSourcePlacementSnapshot(intent);
  writeSchedulerCalendarHandoff({
    anchorDate: intent.practiceDateKey?.trim() || '',
    view: 'week',
    providerFilter: intent.primaryProviderInternalId?.trim() || '',
    routingDoctorPimsId: intent.primaryDoctorPimsId,
    routingDoctorLabel: intent.primaryDoctorDisplayName,
  });
  navigate('/schedule/routing');
  return { ok: true };
}

export { resolveHoldClientLabel } from './holdsDisplay';

import type { NavigateFunction } from 'react-router';
import { DateTime } from 'luxon';
import type { HoldListItem } from '../api/holds';
import {
  fetchAppointmentById,
  fetchAppointmentsRangeForLocalDay,
} from '../api/appointments';
import { fetchAppointmentRequestSubmission } from '../api/appointmentRequestSubmissions';
import {
  buildRoutingRescheduleIntentFromAppointment,
  collectSameDayHouseholdVisits,
  writeRoutingRescheduleIntent,
  type RescheduleSameDayVisit,
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

/** Convert Holds-board rows into reschedule visit targets (chip → appointment id). */
export function holdListItemsToRescheduleVisits(
  holds: readonly HoldListItem[]
): RescheduleSameDayVisit[] {
  const byPatient = new Map<string, RescheduleSameDayVisit>();
  const noPatient: RescheduleSameDayVisit[] = [];

  for (const h of holds) {
    if (typeof h.id !== 'number' || !Number.isFinite(h.id) || h.id <= 0) continue;
    if (h.allDay) continue;
    const patientId = h.patient?.id != null ? String(h.patient.id) : '';
    const typeRaw = h.appointmentType?.id;
    const appointmentTypeId =
      typeRaw != null && Number.isFinite(Number(typeRaw)) ? Number(typeRaw) : undefined;
    const appointmentTypeName =
      h.appointmentType?.prettyName?.trim() ||
      h.appointmentType?.name?.trim() ||
      undefined;
    const visit: RescheduleSameDayVisit = {
      appointmentId: h.id,
      patientId,
      patientName: h.patient?.name?.trim() || undefined,
      appointmentTypeId,
      appointmentTypeName,
      description: h.description ?? null,
    };
    if (!patientId) {
      noPatient.push(visit);
      continue;
    }
    if (!byPatient.has(patientId)) byPatient.set(patientId, visit);
  }

  const out = [...byPatient.values()].sort((a, b) =>
    (a.patientName ?? a.patientId).localeCompare(b.patientName ?? b.patientId, undefined, {
      sensitivity: 'base',
    })
  );
  const seenAppt = new Set(out.map((v) => v.appointmentId));
  for (const v of noPatient) {
    if (seenAppt.has(v.appointmentId)) continue;
    seenAppt.add(v.appointmentId);
    out.push(v);
  }
  return out;
}

/** Merge visit lists, keeping the first entry per patient id. */
export function mergeRescheduleSameDayVisits(
  ...lists: ReadonlyArray<ReadonlyArray<RescheduleSameDayVisit>>
): RescheduleSameDayVisit[] {
  const byPatient = new Map<string, RescheduleSameDayVisit>();
  const noPatient: RescheduleSameDayVisit[] = [];
  const seenNoPatientAppt = new Set<number>();

  for (const list of lists) {
    for (const v of list) {
      const patientId = String(v.patientId ?? '').trim();
      if (!patientId) {
        if (seenNoPatientAppt.has(v.appointmentId)) continue;
        seenNoPatientAppt.add(v.appointmentId);
        noPatient.push(v);
        continue;
      }
      if (!byPatient.has(patientId)) byPatient.set(patientId, v);
    }
  }

  const out = [...byPatient.values()].sort((a, b) =>
    (a.patientName ?? a.patientId).localeCompare(b.patientName ?? b.patientId, undefined, {
      sensitivity: 'base',
    })
  );
  out.push(...noPatient);
  return out;
}

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
 *
 * Pass `householdHolds` (all holds for this client on the board, any date) so
 * selecting those pets in Routing moves every matching hold — not only the
 * clicked row. Same-day calendar siblings are merged when available.
 */
export async function beginHoldReschedule(args: {
  hold: HoldListItem;
  /** All holds for this household on the board (cross-day siblings included). */
  householdHolds?: readonly HoldListItem[];
  navigate: NavigateFunction;
  practiceTz: string;
  practiceId: number;
  /** Where "Dismiss" in the reschedule workspace should return (the Holds board). */
  returnPath?: string;
}): Promise<BeginHoldRescheduleResult> {
  const { hold, householdHolds, navigate, practiceTz, practiceId, returnPath } = args;
  const appt = await fetchAppointmentById(hold.id, { practiceId });
  if (!appt) {
    return { ok: false, reason: 'Could not load this hold to reschedule.' };
  }

  const startLocal = DateTime.fromISO(appt.appointmentStart, { zone: 'utc' }).setZone(practiceTz);
  const dateIso = startLocal.isValid ? startLocal.toISODate() : null;
  const providerId = appt.primaryProvider?.id;

  let sameCalendarDayAppointments: Awaited<ReturnType<typeof fetchAppointmentsRangeForLocalDay>> =
    [];
  if (dateIso && providerId != null) {
    try {
      sameCalendarDayAppointments = await fetchAppointmentsRangeForLocalDay({
        dateIso,
        practiceTimeZone: practiceTz,
        primaryProviderId: providerId,
        practiceId,
      });
    } catch {
      /* hold-list siblings below still cover multi-pet holds */
    }
  }

  const intent = buildRoutingRescheduleIntentFromAppointment(appt, {
    practiceTz,
    allowAddressOnly: true,
    sameCalendarDayAppointments,
  });
  if (!intent) {
    return {
      ok: false,
      reason: 'This hold cannot be rescheduled (needs a linked client or a visit address).',
    };
  }

  const holdVisits = holdListItemsToRescheduleVisits(
    householdHolds && householdHolds.length > 0 ? householdHolds : [hold]
  );
  const calendarVisits =
    sameCalendarDayAppointments.length > 0
      ? collectSameDayHouseholdVisits(appt, sameCalendarDayAppointments, practiceTz)
      : (intent.sameDayVisits ?? []);
  const sameDayVisits = mergeRescheduleSameDayVisits(holdVisits, calendarVisits);
  const moveHousehold = sameDayVisits.length > 1;

  const nextIntent = {
    ...intent,
    sameDayVisits,
    rescheduleScope: moveHousehold
      ? ('household_day' as const)
      : ('selected_pet' as const),
    ...(returnPath?.trim() ? { returnPath: returnPath.trim() } : {}),
  };

  writeRoutingRescheduleIntent(nextIntent);
  void fetchAndCacheRescheduleSourcePlacementSnapshot(nextIntent);
  writeSchedulerCalendarHandoff({
    anchorDate: nextIntent.practiceDateKey?.trim() || '',
    view: 'week',
    providerFilter: nextIntent.primaryProviderInternalId?.trim() || '',
    routingDoctorPimsId: nextIntent.primaryDoctorPimsId,
    routingDoctorLabel: nextIntent.primaryDoctorDisplayName,
  });
  navigate('/schedule/routing');
  return { ok: true };
}

export { resolveHoldClientLabel } from './holdsDisplay';

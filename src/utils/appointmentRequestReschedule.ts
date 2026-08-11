import { DateTime } from 'luxon';
import type { NavigateFunction } from 'react-router';
import {
  fetchAppointmentById,
  fetchAppointmentsRangeForLocalDay,
} from '../api/appointments';
import type { AppointmentRequestSubmissionItem } from '../api/appointmentRequestSubmissions';
import { requestDataPetRowSummaries } from './appointmentRequestDetailDisplay';
import { dismissRoutingAppointmentRequestWorkspace } from './routingAppointmentRequestIntent';
import {
  buildRoutingRescheduleIntentFromAppointment,
  writeRoutingRescheduleIntent,
  type RescheduleSameDayVisit,
} from './routingRescheduleIntent';
import { fetchAndCacheRescheduleSourcePlacementSnapshot } from './routingRescheduleScoreCompare';

const DEFAULT_PRACTICE_ID = Number(import.meta.env.VITE_PRACTICE_ID) || 1;

function appointmentIsTodayOrFuture(apptStart: string, practiceTz: string): boolean {
  const start = DateTime.fromISO(apptStart, { zone: 'utc' }).setZone(practiceTz);
  if (!start.isValid) return false;
  const todayStart = DateTime.now().setZone(practiceTz).startOf('day');
  return start >= todayStart;
}

function submissionPetNameSet(requestData: Record<string, unknown>): Set<string> {
  return new Set(
    requestDataPetRowSummaries(requestData)
      .map((p) => p.name.trim().toLowerCase())
      .filter(Boolean)
  );
}

function filterSameDayVisitsForSubmissionPets(
  visits: RescheduleSameDayVisit[],
  submissionPetNames: Set<string>
): RescheduleSameDayVisit[] {
  if (submissionPetNames.size <= 1) return visits;
  const matched = visits.filter((v) =>
    submissionPetNames.has((v.patientName ?? '').trim().toLowerCase())
  );
  return matched.length > 0 ? matched : visits;
}

/** Open Routing in reschedule mode for a booked appointment request (not new-book mode). */
export async function startRescheduleFromBookedAppointmentRequest(args: {
  submission: AppointmentRequestSubmissionItem;
  practiceId?: number;
  practiceTz: string;
  navigate: NavigateFunction;
  returnToGmail?: { mailbox: string; threadId: string };
}): Promise<{ error?: string }> {
  const apptId = args.submission.bookedAppointmentId;
  if (apptId == null) {
    return { error: 'No linked appointment to reschedule.' };
  }

  dismissRoutingAppointmentRequestWorkspace();

  const practiceId = args.practiceId ?? DEFAULT_PRACTICE_ID;
  const practiceTz = args.practiceTz;

  let appt;
  try {
    appt = await fetchAppointmentById(Number(apptId), { practiceId });
  } catch {
    return { error: 'Could not load the linked appointment.' };
  }

  if (!appt) {
    return { error: 'Could not load the linked appointment.' };
  }

  if (!appointmentIsTodayOrFuture(appt.appointmentStart, practiceTz)) {
    return { error: 'Visits before today cannot be rescheduled here.' };
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
      /* single-visit fallback below */
    }
  }

  const built = buildRoutingRescheduleIntentFromAppointment(appt, {
    practiceTz,
    sameCalendarDayAppointments,
  });
  if (!built) {
    return {
      error: 'This visit cannot be rescheduled here (needs a linked client or a visit address, not a block).',
    };
  }

  const submissionPetNames = submissionPetNameSet(args.submission.requestData ?? {});
  const sameDayVisits = filterSameDayVisitsForSubmissionPets(
    built.sameDayVisits ?? [],
    submissionPetNames
  );
  const moveHousehold =
    submissionPetNames.size > 1 && sameDayVisits.length > 1;

  const intent = {
    ...built,
    sameDayVisits,
    rescheduleScope: moveHousehold
      ? ('household_day' as const)
      : sameDayVisits.length > 1
        ? built.rescheduleScope
        : ('selected_pet' as const),
    ...(args.returnToGmail ? { returnToGmail: args.returnToGmail } : {}),
  };

  writeRoutingRescheduleIntent(intent);
  void fetchAndCacheRescheduleSourcePlacementSnapshot(intent);
  args.navigate('/schedule/routing');
  return {};
}

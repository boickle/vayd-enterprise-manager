import { DateTime } from 'luxon';
import type { NavigateFunction } from 'react-router';
import {
  fetchAppointmentById,
  fetchAppointmentsRangeForLocalDay,
} from '../api/appointments';
import type { WaitlistEntry } from '../api/waitlist';
import { clearRoutingForwardBookingIntent } from './routingForwardBookingIntent';
import {
  buildRoutingRescheduleIntentFromAppointment,
  writeRoutingRescheduleIntent,
  type RescheduleSameDayVisit,
} from './routingRescheduleIntent';
import { fetchAndCacheRescheduleSourcePlacementSnapshot } from './routingRescheduleScoreCompare';
import { writeSchedulerCalendarHandoff } from './schedulerCalendarHandoff';
import { waitlistRoutingSearchDateRange } from './waitlistForwardBooking';

const DEFAULT_PRACTICE_ID = Number(import.meta.env.VITE_PRACTICE_ID) || 1;

function appointmentIsTodayOrFuture(apptStart: string, practiceTz: string): boolean {
  const start = DateTime.fromISO(apptStart, { zone: 'utc' }).setZone(practiceTz);
  if (!start.isValid) return false;
  const todayStart = DateTime.now().setZone(practiceTz).startOf('day');
  return start >= todayStart;
}

function waitlistPatientIdSet(entry: WaitlistEntry): Set<string> {
  const ids = new Set<string>();
  for (const p of entry.patients ?? []) {
    if (p?.id != null && Number.isFinite(Number(p.id)) && Number(p.id) > 0) {
      ids.add(String(p.id));
    }
  }
  for (const id of entry.patientIds ?? []) {
    if (id != null && Number.isFinite(Number(id)) && Number(id) > 0) {
      ids.add(String(id));
    }
  }
  return ids;
}

/**
 * Prefer waitlist pets when the linked visit's household day has more pets than the
 * waitlist row (same idea as appointment-request reschedule pet filtering).
 */
export function filterSameDayVisitsForWaitlistPets(
  visits: RescheduleSameDayVisit[],
  waitlistPatientIds: Set<string>,
): RescheduleSameDayVisit[] {
  if (waitlistPatientIds.size === 0) return visits;
  const matched = visits.filter((v) => waitlistPatientIds.has(String(v.patientId ?? '').trim()));
  return matched.length > 0 ? matched : visits;
}

/**
 * Waitlist "Recommend slot" for a household that already has a confirmed visit
 * ("Has … — wants sooner"): open Explore alternatives so the original stays booked
 * and staff can HOLD both while waiting to hear from the client.
 */
export async function startExploreAlternativesFromWaitlist(args: {
  entry: WaitlistEntry;
  navigate: NavigateFunction;
  practiceTz: string;
  practiceId?: number;
  /** Fill-a-cancellation doctor filter (practice calendar provider id). */
  primaryProviderInternalId?: number | null;
  primaryDoctorPimsId?: string | null;
  primaryDoctorDisplayName?: string | null;
  /** Fill-a-cancellation target day (`YYYY-MM-DD`); blank → next 14 days. */
  targetDateYmd?: string | null;
  returnHref: string;
}): Promise<{ error?: string }> {
  const bookedId = args.entry.bookedAppointmentId;
  if (bookedId == null || !Number.isFinite(Number(bookedId)) || Number(bookedId) <= 0) {
    return { error: 'No linked appointment to offer an alternative for.' };
  }

  const practiceId = args.practiceId ?? DEFAULT_PRACTICE_ID;
  const practiceTz = args.practiceTz;

  clearRoutingForwardBookingIntent();

  let appt;
  try {
    appt = await fetchAppointmentById(Number(bookedId), { practiceId });
  } catch {
    return { error: 'Could not load the linked appointment.' };
  }
  if (!appt) {
    return { error: 'Could not load the linked appointment.' };
  }

  if (!appointmentIsTodayOrFuture(appt.appointmentStart, practiceTz)) {
    return { error: 'Visits before today cannot explore alternatives here.' };
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
    exploreAlternatives: true,
    allowAddressOnly: true,
  });
  if (!built) {
    return {
      error:
        'This visit cannot explore alternatives here (needs a linked client or a visit address, not a block).',
    };
  }

  const waitlistPets = waitlistPatientIdSet(args.entry);
  const sameDayVisits = filterSameDayVisitsForWaitlistPets(
    built.sameDayVisits ?? [],
    waitlistPets,
  );
  const moveHousehold = waitlistPets.size > 1 && sameDayVisits.length > 1;

  const providerInternal =
    args.primaryProviderInternalId != null &&
    Number.isFinite(Number(args.primaryProviderInternalId)) &&
    Number(args.primaryProviderInternalId) > 0
      ? String(args.primaryProviderInternalId)
      : undefined;
  const doctorPims = args.primaryDoctorPimsId?.trim() || undefined;
  const doctorName = args.primaryDoctorDisplayName?.trim() || undefined;

  const routingSearch = waitlistRoutingSearchDateRange(
    args.targetDateYmd?.trim() || null,
    practiceTz,
  );

  const serviceMinutes =
    args.entry.serviceMinutes != null && args.entry.serviceMinutes > 0
      ? args.entry.serviceMinutes
      : built.serviceMinutes;

  const intent = {
    ...built,
    sameDayVisits,
    rescheduleScope: moveHousehold
      ? ('household_day' as const)
      : sameDayVisits.length > 1
        ? built.rescheduleScope
        : ('selected_pet' as const),
    exploreAlternatives: true as const,
    returnPath: args.returnHref,
    routingSearch,
    serviceMinutes,
    // Fill-a-cancellation doctor is the *search* target only — keep source* from the
    // linked visit so explore score compare stays against the original assignee.
    ...(providerInternal ? { primaryProviderInternalId: providerInternal } : {}),
    ...(doctorPims ? { primaryDoctorPimsId: doctorPims } : {}),
    ...(doctorName ? { primaryDoctorDisplayName: doctorName } : {}),
  };

  writeRoutingRescheduleIntent(intent);
  void fetchAndCacheRescheduleSourcePlacementSnapshot(intent);
  const handoffAnchor =
    args.targetDateYmd?.trim() ||
    intent.practiceDateKey?.trim() ||
    routingSearch.startDate ||
    '';
  writeSchedulerCalendarHandoff({
    anchorDate: handoffAnchor,
    view: 'week',
    providerFilter: intent.primaryProviderInternalId?.trim() || '',
    routingDoctorPimsId: intent.primaryDoctorPimsId,
    routingDoctorLabel: intent.primaryDoctorDisplayName,
  });
  args.navigate('/schedule/routing');
  return {};
}

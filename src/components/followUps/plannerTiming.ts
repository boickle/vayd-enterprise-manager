import type { AppointmentType } from '../../api/appointmentSettings';
import type { AvgMinutesByTypeRow } from '../../analytics/appointmentTypeTimeStats';
import {
  appointmentTypeIncludedInRouting,
  sortAppointmentTypesForPicker,
} from '../../utils/appointmentTypeSettings';
import { appointmentTypeForRoutingStatsKey } from '../../utils/routingCalculateTimeType';
import {
  estimateRoutingServiceMinutesForVisit,
  fetchDoctorApptLengthStats,
  type RoutingServiceMinutesEstimateSource,
} from '../../utils/routingServiceMinutes';
import type { PlannerInterval } from './plannerModel';

/**
 * Visit types and lengths for the planner. Lengths come from the same 30-day per-doctor
 * history Routing uses (type averages, multi-pet averages for households), falling back to
 * the type's default length when a doctor has fewer than 5 visits of that type.
 */

export function appointmentTypeLabel(t: Pick<AppointmentType, 'name' | 'prettyName'>): string {
  return (t.prettyName || t.name || '').trim();
}

/** The type's own name (not the client-facing pretty name), for staff pickers. */
export function appointmentTypeStaffName(t: Pick<AppointmentType, 'name' | 'prettyName'>): string {
  return (t.name || t.prettyName || '').trim();
}

/** Types a follow-up can be booked as: active, routable, and not a hold or boarding. */
export function plannerBookableTypes(all: readonly AppointmentType[]): AppointmentType[] {
  return sortAppointmentTypesForPicker(
    all.filter(
      (t) =>
        t.isActive !== false &&
        t.isDeleted !== true &&
        t.isBoardingType !== true &&
        t.isHold !== true &&
        appointmentTypeIncludedInRouting(t)
    )
  );
}

/** Starting suggestion only; the tech always confirms the type. */
export function suggestTypeIdForInterval(
  interval: PlannerInterval,
  types: readonly AppointmentType[]
): number | null {
  const long =
    (interval.kind === 'preset' && (interval.key === '6m' || interval.key === '1y')) ||
    (interval.kind === 'custom' &&
      ((interval.unit === 'months' && interval.amount >= 6) || interval.unit === 'years'));
  const pattern = long ? /wellness|annual/i : /recheck/i;
  return types.find((t) => pattern.test(appointmentTypeLabel(t)))?.id ?? null;
}

export type MinutesEstimate = {
  minutes: number;
  /** `stats` = this provider's last 30 days; otherwise the type's default length. */
  source: RoutingServiceMinutesEstimateSource;
};

function estimate(
  typeIds: readonly number[],
  rows: AvgMinutesByTypeRow[],
  all: readonly AppointmentType[]
): MinutesEstimate {
  const r = estimateRoutingServiceMinutesForVisit(
    typeIds.map((appointmentTypeId) => ({ appointmentTypeId })),
    rows,
    (id) => all.find((t) => Number(t.id) === Number(id)),
    (key) => appointmentTypeForRoutingStatsKey(key, all)
  );
  return { minutes: r.serviceMinutes, source: r.source };
}

/** Length of a new visit for these pets (one type id per pet). */
export function estimateVisitMinutes(
  typeIds: readonly number[],
  rows: AvgMinutesByTypeRow[],
  all: readonly AppointmentType[]
): MinutesEstimate {
  return estimate(typeIds, rows, all);
}

/**
 * Extra time when pets join a housemate's visit: the visit's history-based length with
 * them minus its length without them. Never less than 5 minutes.
 */
export function estimateAddedMinutes(
  existingTypeIds: readonly number[],
  addedTypeIds: readonly number[],
  rows: AvgMinutesByTypeRow[],
  all: readonly AppointmentType[]
): MinutesEstimate {
  const before = estimate(existingTypeIds, rows, all);
  const after = estimate([...existingTypeIds, ...addedTypeIds], rows, all);
  return { minutes: Math.max(5, after.minutes - before.minutes), source: after.source };
}

/** One history load per provider per planner session. */
export function createProviderStatsCache() {
  const cache = new Map<number, Promise<AvgMinutesByTypeRow[]>>();
  return (providerId: number | null | undefined): Promise<AvgMinutesByTypeRow[]> => {
    if (providerId == null) return Promise.resolve([]);
    let p = cache.get(providerId);
    if (!p) {
      p = fetchDoctorApptLengthStats(String(providerId)).catch(() => []);
      cache.set(providerId, p);
    }
    return p;
  };
}

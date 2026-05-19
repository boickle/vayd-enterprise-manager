import {
  fetchScheduleOverrides,
  scheduleOverrideIsOff,
  normalizeScheduleOverrideLocalTime,
  type ScheduleOverride,
} from '../api/appointmentSettings';
import type { DayBundleIn } from './schedulerEtaMerge';

function depotFromOverride(lat?: number | null, lon?: number | null): { lat: number; lon: number } | null {
  if (lat == null || lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

/**
 * Apply per-date schedule override onto doctor-day bundle used by the practice scheduler.
 * GET /appointments/doctor does not merge overrides — routing API reads them separately.
 */
export function applyScheduleOverrideToDayBundle(
  bundle: DayBundleIn | null,
  override: ScheduleOverride | null | undefined,
  fallbackTimezone = 'America/New_York'
): DayBundleIn | null {
  if (!override) return bundle;

  const date = override.date || bundle?.date;
  if (!date) return bundle;

  if (scheduleOverrideIsOff(override)) {
    const base: DayBundleIn = bundle ?? {
      date,
      timezone: fallbackTimezone,
      households: [],
      timeline: [],
      startDepot: null,
      endDepot: null,
      startDepotTown: null,
      startDepotTime: null,
      endDepotTime: null,
    };
    return {
      ...base,
      startDepotTime: null,
      endDepotTime: null,
    };
  }

  if (!bundle) return bundle;

  const startDepotTime = normalizeScheduleOverrideLocalTime(override.workStartLocal) || null;
  const endDepotTime = normalizeScheduleOverrideLocalTime(override.workEndLocal) || null;
  const startDepot =
    depotFromOverride(override.startDepotLat, override.startDepotLon) ?? bundle.startDepot;
  const endDepot = depotFromOverride(override.endDepotLat, override.endDepotLon) ?? bundle.endDepot;

  return {
    ...bundle,
    startDepotTime,
    endDepotTime,
    startDepot,
    endDepot,
  };
}

/** Load overrides for a list of calendar dates (inclusive range from sorted ISO dates). */
export async function fetchScheduleOverridesByDate(
  employeeId: number,
  dates: string[]
): Promise<Map<string, ScheduleOverride>> {
  if (!Number.isFinite(employeeId) || dates.length === 0) return new Map();
  const sorted = [...dates].sort();
  const list = await fetchScheduleOverrides(employeeId, {
    startDate: sorted[0]!,
    endDate: sorted[sorted.length - 1]!,
  });
  return new Map(list.map((o) => [o.date, o]));
}

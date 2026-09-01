import { DateTime } from 'luxon';
import type { DayData, WeekHousehold } from '../pages/MyWeek';
import { dayPoints, dayTotalDriveSeconds, doctorDayIsOff } from '../pages/MyWeek';
import type { AppointmentTypeCatalog } from './appointmentTypeSettings';
import { appointmentIsCalendarOnlyStaffItem } from './calendarOnlyStaffAppointment';
import { householdsInRoutingDisplayOrder } from './maps';
import { pointsPerDriveHour } from './pointsPerDriveHour';

export type OptimizeWindowWeeks = 1 | 2;
export type OptimizeWindowMode = 'visible-week' | 'rolling';

/**
 * Calendar week on screen:
 * - Future week → that Sunday–Saturday week (plus the following week when `weekCount` is 2)
 * - Week that includes today → tomorrow through +7 or +14 days (never today or earlier)
 */
export function optimizeWindowDates(
  weekDates: string[],
  todayIso: string,
  practiceTz: string,
  weekCount: OptimizeWindowWeeks = 1
): { dates: string[]; mode: OptimizeWindowMode } {
  const weeks: OptimizeWindowWeeks = weekCount === 2 ? 2 : 1;
  const today = todayIso.trim();
  if (!today) return { dates: [], mode: 'visible-week' };
  if (weekDates.length > 0 && weekDates.every((d) => d > today)) {
    const dates = [...weekDates];
    if (weeks === 2) {
      const last = DateTime.fromISO(dates[dates.length - 1]!, { zone: practiceTz }).startOf('day');
      if (last.isValid) {
        for (let i = 1; i <= 7; i++) {
          const iso = last.plus({ days: i }).toISODate();
          if (iso) dates.push(iso);
        }
      }
    }
    return { dates, mode: 'visible-week' };
  }
  if (weekDates.length > 0 && weekDates.every((d) => d < today)) {
    return { dates: [], mode: 'visible-week' };
  }
  const start = DateTime.fromISO(today, { zone: practiceTz }).startOf('day');
  if (!start.isValid) return { dates: [], mode: 'rolling' };
  const dates = Array.from({ length: weeks * 7 }, (_, i) => start.plus({ days: i + 1 }).toISODate()!);
  return { dates, mode: 'rolling' };
}

const OUTLIER_RATIO = 2;
const OUTLIER_MIN_SEC = 20 * 60;
const MIN_CLIENT_STOPS_FOR_OUTLIERS = 3;
/** Flag a working day when its PPDH is below this fraction of the week ratio. */
const LOW_PPDH_FRACTION = 0.75;

export type OptimizeOutlier = {
  client: string;
  hopMin: number;
};

export type OptimizeDayRow = {
  date: string;
  isOff: boolean;
  stopCount: number;
  points: number;
  driveMin: number;
  ppdh: number | null;
  outliers: OptimizeOutlier[];
  lowPpdh: boolean;
  error?: string;
};

export type OptimizeBaseline = {
  dates: string[];
  days: OptimizeDayRow[];
  totalPoints: number;
  totalDriveMin: number;
  ppdh: number | null;
};

export function isRoutableOptimizeStop(h: WeekHousehold): boolean {
  if (h.isPersonalBlock || h.isNoLocation) return false;
  if (appointmentIsCalendarOnlyStaffItem(h.primary)) return false;
  return (
    Number.isFinite(h.lat) &&
    Number.isFinite(h.lon) &&
    Math.abs(h.lat) > 1e-6 &&
    Math.abs(h.lon) > 1e-6
  );
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function hopSecondsToIndex(driveSeconds: number[], fromIndex: number, toIndex: number): number {
  if (toIndex <= fromIndex) return 0;
  let sum = 0;
  for (let i = fromIndex + 1; i <= toIndex; i++) {
    const hop = driveSeconds[i];
    if (typeof hop === 'number' && Number.isFinite(hop)) sum += hop;
  }
  return sum;
}

export type OptimizeOutlierHousehold = {
  household: WeekHousehold;
  hopMin: number;
};

/**
 * Client stops on the far side of a long hop (20+ min and 2× the day's median
 * client-to-client hop). Middle stops must be a detour (long hop in and out).
 * Depot legs are ignored so "the whole day is far from the office" is not an outlier.
 */
export function findDayOutlierHouseholds(day: DayData): OptimizeOutlierHousehold[] {
  const ordered = householdsInRoutingDisplayOrder(day.households, day.routingOrderIndices);
  const clientIdx: number[] = [];
  for (let i = 0; i < ordered.length; i++) {
    if (isRoutableOptimizeStop(ordered[i]!)) clientIdx.push(i);
  }
  if (clientIdx.length < MIN_CLIENT_STOPS_FOR_OUTLIERS) return [];

  const ds = Array.isArray(day.driveSeconds) ? day.driveSeconds : [];
  if (ds.length < 2) return [];

  const clientHops: number[] = [];
  for (let c = 1; c < clientIdx.length; c++) {
    clientHops.push(hopSecondsToIndex(ds, clientIdx[c - 1]!, clientIdx[c]!));
  }
  const med = median(clientHops.filter((h) => h > 0));
  const threshold = Math.max(OUTLIER_MIN_SEC, med * OUTLIER_RATIO);
  if (!(threshold > 0)) return [];

  const out: OptimizeOutlierHousehold[] = [];
  for (let c = 0; c < clientIdx.length; c++) {
    const idx = clientIdx[c]!;
    const inbound = c > 0 ? hopSecondsToIndex(ds, clientIdx[c - 1]!, idx) : 0;
    const outbound =
      c < clientIdx.length - 1 ? hopSecondsToIndex(ds, idx, clientIdx[c + 1]!) : 0;
    const facing =
      c === 0
        ? outbound
        : c === clientIdx.length - 1
          ? inbound
          : inbound >= threshold && outbound >= threshold
            ? Math.max(inbound, outbound)
            : 0;
    if (facing >= threshold) {
      out.push({ household: ordered[idx]!, hopMin: Math.round(facing / 60) });
    }
  }
  return out;
}

export function findDayOutliers(day: DayData): OptimizeOutlier[] {
  return findDayOutlierHouseholds(day).map((row) => ({
    client: row.household.client?.trim() || 'Unknown client',
    hopMin: row.hopMin,
  }));
}

export function buildOptimizeBaseline(
  dates: string[],
  dayByDate: Map<string, DayData | null>,
  typeCatalog: AppointmentTypeCatalog,
  errors?: Map<string, string>
): OptimizeBaseline {
  const days: OptimizeDayRow[] = dates.map((date) => {
    const error = errors?.get(date)?.trim() || undefined;
    const day = dayByDate.get(date) ?? null;
    if (!day) {
      return {
        date,
        isOff: false,
        stopCount: 0,
        points: 0,
        driveMin: 0,
        ppdh: null,
        outliers: [],
        lowPpdh: false,
        error: error || 'No schedule data',
      };
    }
    const points = dayPoints(day.households, typeCatalog);
    const driveMin = Math.round(dayTotalDriveSeconds(day) / 60);
    const stopCount = day.households.filter(isRoutableOptimizeStop).length;
    return {
      date,
      isOff: doctorDayIsOff(day),
      stopCount,
      points,
      driveMin,
      ppdh: pointsPerDriveHour(points, driveMin),
      outliers: findDayOutliers(day),
      lowPpdh: false,
      error,
    };
  });

  let totalPoints = 0;
  let totalDriveMin = 0;
  for (const row of days) {
    if (row.isOff && row.stopCount === 0) continue;
    totalPoints += row.points;
    totalDriveMin += row.driveMin;
  }
  const weekPpdh = pointsPerDriveHour(totalPoints, totalDriveMin);
  if (weekPpdh != null && weekPpdh > 0) {
    const floor = weekPpdh * LOW_PPDH_FRACTION;
    for (const row of days) {
      if (row.isOff || row.ppdh == null) continue;
      row.lowPpdh = row.ppdh < floor;
    }
  }

  return {
    dates,
    days,
    totalPoints,
    totalDriveMin,
    ppdh: weekPpdh,
  };
}

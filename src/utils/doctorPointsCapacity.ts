import { type Dayjs } from 'dayjs';

/**
 * Trailing calendar days used for doctor/day-of-week averages.
 */
export const DOCTOR_CAPACITY_LOOKBACK_DAYS = 30;

export type DoctorWeekdayAverage = {
  avgPoints: number;
  sampleDays: number;
};

export type DoctorPointsCapacity = {
  /** JavaScript day-of-week (0 = Sunday, 6 = Saturday) → that doctor's average. */
  byDayOfWeek: Partial<Record<number, DoctorWeekdayAverage>>;
  /** Mean points across all sampled workdays in the window (any weekday). */
  overallAvgPoints: number | null;
};

const EMPTY_CAPACITY: DoctorPointsCapacity = {
  byDayOfWeek: {},
  overallAvgPoints: null,
};

/**
 * Average points for each weekday on which this doctor actually worked in the trailing window.
 * Non-working weekdays are not included, so part-time schedules do not pull the average down.
 */
export function buildDoctorPointsCapacity(
  pointsByDate: Record<string, number> | undefined,
  histStart: Dayjs,
  histEnd: Dayjs,
  opts?: {
    timeOffDates?: ReadonlySet<string>;
    /** Whether the doctor was scheduled to work this date. */
    isWorkday?: (date: string) => boolean;
  }
): DoctorPointsCapacity {
  const sums: Partial<Record<number, number>> = {};
  const counts: Partial<Record<number, number>> = {};
  let d = histStart.startOf('day');
  const end = histEnd.startOf('day');
  while (!d.isAfter(end)) {
    const dateStr = d.format('YYYY-MM-DD');
    const dayOfWeek = d.day();
    d = d.add(1, 'day');
    if (opts?.timeOffDates?.has(dateStr)) continue;
    if (opts?.isWorkday && !opts.isWorkday(dateStr)) continue;
    const rawPoints = Number(pointsByDate?.[dateStr] ?? 0);
    const pts = Number.isFinite(rawPoints) ? Math.max(0, rawPoints) : 0;
    sums[dayOfWeek] = (sums[dayOfWeek] ?? 0) + pts;
    counts[dayOfWeek] = (counts[dayOfWeek] ?? 0) + 1;
  }

  const byDayOfWeek: DoctorPointsCapacity['byDayOfWeek'] = {};
  let overallSum = 0;
  let overallDays = 0;
  for (let dayOfWeek = 0; dayOfWeek <= 6; dayOfWeek += 1) {
    const sampleDays = counts[dayOfWeek] ?? 0;
    if (sampleDays <= 0) continue;
    const avgPoints = (sums[dayOfWeek] ?? 0) / sampleDays;
    byDayOfWeek[dayOfWeek] = { avgPoints, sampleDays };
    overallSum += sums[dayOfWeek] ?? 0;
    overallDays += sampleDays;
  }
  return {
    byDayOfWeek,
    overallAvgPoints: overallDays > 0 ? overallSum / overallDays : null,
  };
}

export type DoctorTypicalDay = {
  /** Average for this doctor on this weekday. */
  points: number | null;
  sampleDays: number;
  /** No matching weekday history existed, so the configured point goal stood in. */
  usedGoalFallback: boolean;
};

/**
 * Resolve one doctor's expectation for the weekday of a future date.
 * There is deliberately no practice-average or booking-fill adjustment: this number is the
 * doctor's own recent average for that weekday, floored only by points already booked.
 */
export function projectDoctorWeekdayPoints(args: {
  bookedPoints: number;
  date: string;
  capacity: DoctorPointsCapacity | undefined;
  dailyPointGoal?: number | null;
}): DoctorTypicalDay & { projectedPoints: number } {
  const booked = Math.max(0, Number(args.bookedPoints) || 0);
  const weekday =
    args.capacity?.byDayOfWeek[args.date ? new Date(`${args.date}T12:00:00`).getDay() : -1];
  // A 0 average usually means this weekday was not actually worked in the lookback
  // (e.g. a newly added Saturday) rather than a true empty workday.
  const weekdayAvg =
    weekday != null && weekday.avgPoints > 0 ? weekday.avgPoints : null;
  const goal = Number(args.dailyPointGoal);
  const goalFallback = Number.isFinite(goal) && goal > 0 ? goal : null;
  const overall =
    args.capacity?.overallAvgPoints != null && args.capacity.overallAvgPoints > 0
      ? args.capacity.overallAvgPoints
      : null;
  const typical = weekdayAvg ?? goalFallback ?? overall;

  return {
    points: typical,
    sampleDays: weekdayAvg != null ? (weekday?.sampleDays ?? 0) : 0,
    usedGoalFallback: weekdayAvg == null && typical != null,
    projectedPoints: Math.max(booked, typical ?? 0),
  };
}

import { type Dayjs } from 'dayjs';

/**
 * Trailing calendar days used for doctor/day-of-week averages.
 * Eight weeks gives most weekdays 6–8 samples; 30 days left only 2–4, so one odd week
 * rewrote every future instance of that weekday.
 */
export const DOCTOR_CAPACITY_LOOKBACK_DAYS = 56;

/** Late bookings may lift a day above its typical points, but not without limit. */
const MAX_TYPICAL_MULTIPLE = 1.5;

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
 *
 * `points` is the doctor's own recent average for that weekday, scaled by `shiftFraction`
 * for shortened days. With a `fillFraction` (share of a day's final points typically
 * already booked this many days out), expected points are what is booked plus the typical
 * late fill: booked + typical × (1 − fillFraction). A day that is behind its usual pace
 * stays behind; a day already near final is not topped up to the average. Without a fill
 * fraction, falls back to max(booked, typical).
 */
export function projectDoctorWeekdayPoints(args: {
  bookedPoints: number;
  date: string;
  capacity: DoctorPointsCapacity | undefined;
  dailyPointGoal?: number | null;
  /** Scheduled hours ÷ normal weekday hours (half-day overrides). Defaults to 1. */
  shiftFraction?: number | null;
  fillFraction?: number | null;
}): DoctorTypicalDay & { projectedPoints: number } {
  const booked = Math.max(0, Number(args.bookedPoints) || 0);
  const weekday =
    args.capacity?.byDayOfWeek[args.date ? new Date(`${args.date}T12:00:00`).getDay() : -1];
  // A 0 average usually means this weekday was not actually worked in the lookback
  // (e.g. a newly added Saturday) rather than a true empty workday.
  const weekdayAvg = weekday != null && weekday.avgPoints > 0 ? weekday.avgPoints : null;
  const goal = Number(args.dailyPointGoal);
  const goalFallback = Number.isFinite(goal) && goal > 0 ? goal : null;
  const overall =
    args.capacity?.overallAvgPoints != null && args.capacity.overallAvgPoints > 0
      ? args.capacity.overallAvgPoints
      : null;
  const baseTypical = weekdayAvg ?? goalFallback ?? overall;
  const shift = Number(args.shiftFraction);
  const shiftScale = Number.isFinite(shift) ? Math.max(0, Math.min(1, shift)) : 1;
  const typical = baseTypical != null ? baseTypical * shiftScale : null;

  const fill = Number(args.fillFraction);
  let projectedPoints: number;
  if (args.fillFraction != null && Number.isFinite(fill) && typical != null) {
    const stillToBook = typical * Math.max(0, 1 - Math.min(1, fill));
    const ceiling = Math.max(booked, typical * MAX_TYPICAL_MULTIPLE);
    projectedPoints = Math.max(booked, Math.min(booked + stillToBook, ceiling));
  } else {
    projectedPoints = Math.max(booked, typical ?? 0);
  }

  return {
    points: typical,
    sampleDays: weekdayAvg != null ? (weekday?.sampleDays ?? 0) : 0,
    usedGoalFallback: weekdayAvg == null && baseTypical != null,
    projectedPoints,
  };
}

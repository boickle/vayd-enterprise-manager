// Practice-wide appointment bookings goals.
// Daily targets are by day of week (0=Sun … 6=Sat). Period targets are the
// Sunday–Saturday week, calendar month, and calendar quarter.
// Stored in practice settings; daily targets are used by Appointments analytics
// vs the hardcoded default of 37.
import { DateTime } from 'luxon';
import {
  getPracticeSettings,
  updatePracticeSettings,
} from './practiceSettings';

export const APPOINTMENT_BOOKINGS_GOALS_BY_DOW_KEY =
  'appointmentBookings.goalsByDayOfWeek';

export const APPOINTMENT_BOOKINGS_PERIOD_GOALS_KEY =
  'appointmentBookings.periodGoals';

export const DEFAULT_APPOINTMENT_BOOKINGS_GOAL = 37;

export type AppointmentBookingsPeriodGoals = {
  weekly: number;
  monthly: number;
  quarterly: number;
};

export type AppointmentBookingsGoalSettings = {
  byDayOfWeek: AppointmentBookingsGoalsByDow;
  period: AppointmentBookingsPeriodGoals;
};

export type AppointmentBookingPeriodWindow = {
  key: keyof AppointmentBookingsPeriodGoals;
  title: string;
  label: string;
  startDate: string;
  endDate: string;
};

export type AppointmentBookingsGoalsByDow = Record<number, number>;

export function defaultAppointmentBookingsGoalsByDow(): AppointmentBookingsGoalsByDow {
  return {
    0: DEFAULT_APPOINTMENT_BOOKINGS_GOAL,
    1: DEFAULT_APPOINTMENT_BOOKINGS_GOAL,
    2: DEFAULT_APPOINTMENT_BOOKINGS_GOAL,
    3: DEFAULT_APPOINTMENT_BOOKINGS_GOAL,
    4: DEFAULT_APPOINTMENT_BOOKINGS_GOAL,
    5: DEFAULT_APPOINTMENT_BOOKINGS_GOAL,
    6: DEFAULT_APPOINTMENT_BOOKINGS_GOAL,
  };
}

export function parseAppointmentBookingsGoalsByDow(
  raw: unknown
): AppointmentBookingsGoalsByDow {
  const defaults = defaultAppointmentBookingsGoalsByDow();
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return defaults;
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return defaults;
  }
  const out = { ...defaults };
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    const dow = Number(k);
    const n = Number(v);
    if (Number.isInteger(dow) && dow >= 0 && dow <= 6 && Number.isFinite(n) && n >= 0) {
      out[dow] = n;
    }
  }
  return out;
}

export async function fetchAppointmentBookingsGoalsByDow(
  practiceId: number
): Promise<AppointmentBookingsGoalsByDow> {
  const settings = await getPracticeSettings(practiceId);
  return parseAppointmentBookingsGoalsByDow(
    settings[APPOINTMENT_BOOKINGS_GOALS_BY_DOW_KEY as keyof typeof settings]
  );
}

export async function saveAppointmentBookingsGoalsByDow(
  practiceId: number,
  goals: AppointmentBookingsGoalsByDow
): Promise<AppointmentBookingsGoalsByDow> {
  const normalized = parseAppointmentBookingsGoalsByDow(goals);
  const payload = {
    [APPOINTMENT_BOOKINGS_GOALS_BY_DOW_KEY]: JSON.stringify({
      '0': normalized[0],
      '1': normalized[1],
      '2': normalized[2],
      '3': normalized[3],
      '4': normalized[4],
      '5': normalized[5],
      '6': normalized[6],
    }),
  } as const;
  const updated = await updatePracticeSettings(practiceId, payload);
  return parseAppointmentBookingsGoalsByDow(
    updated[APPOINTMENT_BOOKINGS_GOALS_BY_DOW_KEY as keyof typeof updated]
  );
}

/** Practice-wide bookings per Sunday–Saturday week when no period goal is saved. */
export const DEFAULT_WEEKLY_APPOINTMENT_BOOKINGS_GOAL = 233;

/** Weeks in a year. Month and quarter defaults scale the weekly goal by this. */
const WEEKS_PER_YEAR = 52;

export function defaultAppointmentBookingsPeriodGoals(): AppointmentBookingsPeriodGoals {
  const weekly = DEFAULT_WEEKLY_APPOINTMENT_BOOKINGS_GOAL;
  return {
    weekly,
    monthly: Math.round((weekly * WEEKS_PER_YEAR) / 12),
    quarterly: (weekly * WEEKS_PER_YEAR) / 4,
  };
}

function readNonNegative(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

export function parseAppointmentBookingsPeriodGoals(
  raw: unknown
): AppointmentBookingsPeriodGoals {
  const defaults = defaultAppointmentBookingsPeriodGoals();
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    if (!raw.trim()) return defaults;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return defaults;
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return defaults;
  }
  const obj = parsed as Record<string, unknown>;
  return {
    weekly: readNonNegative(obj.weekly) ?? defaults.weekly,
    monthly: readNonNegative(obj.monthly) ?? defaults.monthly,
    quarterly: readNonNegative(obj.quarterly) ?? defaults.quarterly,
  };
}

export async function fetchAppointmentBookingsGoalSettings(
  practiceId: number
): Promise<AppointmentBookingsGoalSettings> {
  const settings = await getPracticeSettings(practiceId);
  return {
    byDayOfWeek: parseAppointmentBookingsGoalsByDow(
      settings[APPOINTMENT_BOOKINGS_GOALS_BY_DOW_KEY as keyof typeof settings]
    ),
    period: parseAppointmentBookingsPeriodGoals(
      settings[APPOINTMENT_BOOKINGS_PERIOD_GOALS_KEY as keyof typeof settings]
    ),
  };
}

export async function saveAppointmentBookingsGoalSettings(
  practiceId: number,
  goals: AppointmentBookingsGoalSettings
): Promise<AppointmentBookingsGoalSettings> {
  const byDayOfWeek = parseAppointmentBookingsGoalsByDow(goals.byDayOfWeek);
  const period = parseAppointmentBookingsPeriodGoals(goals.period);
  const updated = await updatePracticeSettings(practiceId, {
    [APPOINTMENT_BOOKINGS_GOALS_BY_DOW_KEY]: JSON.stringify({
      '0': byDayOfWeek[0],
      '1': byDayOfWeek[1],
      '2': byDayOfWeek[2],
      '3': byDayOfWeek[3],
      '4': byDayOfWeek[4],
      '5': byDayOfWeek[5],
      '6': byDayOfWeek[6],
    }),
    [APPOINTMENT_BOOKINGS_PERIOD_GOALS_KEY]: JSON.stringify(period),
  });
  return {
    byDayOfWeek: parseAppointmentBookingsGoalsByDow(
      updated[APPOINTMENT_BOOKINGS_GOALS_BY_DOW_KEY as keyof typeof updated]
    ),
    period: parseAppointmentBookingsPeriodGoals(
      updated[APPOINTMENT_BOOKINGS_PERIOD_GOALS_KEY as keyof typeof updated]
    ),
  };
}

/** Whole-number percent of goal. Null when the goal is unset. */
export function percentOfBookingGoal(booked: number, goal: number): number | null {
  if (!(goal > 0) || !Number.isFinite(booked)) return null;
  return Math.round((booked / goal) * 100);
}

export type BookingGoalPace = {
  projected: number;
  percent: number;
};

/**
 * Straight-line pace for a period that still includes `today`, matching
 * production incentives: booked × total days ÷ days elapsed (today counts).
 * Null once the period is over or has not started.
 */
export function bookingGoalPace(
  booked: number,
  goal: number,
  startDate: string,
  endDate: string,
  todayDate: string
): BookingGoalPace | null {
  if (!(goal > 0) || !Number.isFinite(booked)) return null;
  if (todayDate < startDate || todayDate > endDate) return null;
  const start = DateTime.fromISO(startDate);
  const end = DateTime.fromISO(endDate);
  const today = DateTime.fromISO(todayDate);
  if (!start.isValid || !end.isValid || !today.isValid) return null;
  const totalDays = Math.round(end.diff(start, 'days').days) + 1;
  const elapsedDays = Math.round(today.diff(start, 'days').days) + 1;
  if (totalDays <= 0 || elapsedDays <= 0) return null;
  const projected = Math.round((booked * totalDays) / elapsedDays);
  return {
    projected,
    percent: Math.round((projected / goal) * 100),
  };
}

/**
 * Week (Sunday–Saturday), calendar month, and calendar quarter that contain
 * `anchor`. The fetch span covers every day those three windows need.
 */
export function appointmentBookingPeriodsContaining(
  timeZone: string,
  anchor: DateTime
): {
  periods: AppointmentBookingPeriodWindow[];
  fetchStart: string;
  fetchEnd: string;
} {
  const day = anchor.setZone(timeZone).startOf('day');
  const weekStart = day.minus({ days: day.weekday % 7 });
  const weekEnd = weekStart.plus({ days: 6 });
  const monthStart = day.startOf('month');
  const monthEnd = day.endOf('month').startOf('day');
  const quarterStart = day.startOf('quarter');
  const quarterEnd = day.endOf('quarter').startOf('day');

  const periods: AppointmentBookingPeriodWindow[] = [
    {
      key: 'weekly',
      title: 'Weekly',
      label: `${weekStart.toFormat('MMM d')} – ${weekEnd.toFormat('MMM d')}`,
      startDate: weekStart.toISODate() ?? '',
      endDate: weekEnd.toISODate() ?? '',
    },
    {
      key: 'monthly',
      title: 'Monthly',
      label: monthStart.toFormat('MMMM yyyy'),
      startDate: monthStart.toISODate() ?? '',
      endDate: monthEnd.toISODate() ?? '',
    },
    {
      key: 'quarterly',
      title: 'Quarterly',
      label: quarterStart.toFormat("'Q'q yyyy"),
      startDate: quarterStart.toISODate() ?? '',
      endDate: quarterEnd.toISODate() ?? '',
    },
  ];

  const fetchStart = periods.reduce(
    (min, period) => (period.startDate < min ? period.startDate : min),
    periods[0].startDate
  );
  const fetchEnd = periods.reduce(
    (max, period) => (period.endDate > max ? period.endDate : max),
    periods[0].endDate
  );
  return { periods, fetchStart, fetchEnd };
}

/** Sum practice bookings whose day bucket falls inside an inclusive date range. */
export function sumBookedBetween(
  users: { bookingsByDay?: { date?: string; totalBooked?: number }[] }[] | undefined,
  startDate: string,
  endDate: string
): number {
  let total = 0;
  for (const user of users ?? []) {
    for (const day of user.bookingsByDay ?? []) {
      const date = day.date?.slice(0, 10) ?? '';
      if (date >= startDate && date <= endDate) {
        total += Number(day.totalBooked) || 0;
      }
    }
  }
  return total;
}

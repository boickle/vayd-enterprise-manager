// Practice-wide daily appointment bookings goals by day of week (0=Sun … 6=Sat).
// Stored in practice settings; used by Routing Analytics vs the hardcoded default of 37.
import {
  getPracticeSettings,
  updatePracticeSettings,
} from './practiceSettings';

export const APPOINTMENT_BOOKINGS_GOALS_BY_DOW_KEY =
  'appointmentBookings.goalsByDayOfWeek';

export const DEFAULT_APPOINTMENT_BOOKINGS_GOAL = 37;

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

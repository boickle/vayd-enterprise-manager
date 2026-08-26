import { DateTime } from 'luxon';
import { formatForwardBookingSmsDateLabel } from './forwardBookingSmsMessage';
import { businessDaysBetween } from './holdsHousehold';

export type HoldSpotReleaseSmsOpts = {
  practiceTz: string;
  /** Scheduled visit start (ISO) — used to pick the release window. */
  appointmentStartIso: string;
  now?: DateTime;
};

function businessDaysUntilAppointment(
  appointmentStartIso: string,
  practiceTz: string,
  now: DateTime,
): number | null {
  const start = appointmentStartIso.trim();
  if (!start) return null;
  const apptDay = DateTime.fromISO(start, { zone: 'utc' }).setZone(practiceTz);
  if (!apptDay.isValid) return null;
  const days = businessDaysBetween(now.setZone(practiceTz), apptDay);
  return Number.isFinite(days) ? days : null;
}

function calendarDaysUntilAppointment(
  appointmentStartIso: string,
  practiceTz: string,
  now: DateTime,
): number | null {
  const start = appointmentStartIso.trim();
  if (!start) return null;
  const apptDay = DateTime.fromISO(start, { zone: 'utc' }).setZone(practiceTz).startOf('day');
  const today = now.setZone(practiceTz).startOf('day');
  if (!apptDay.isValid || !today.isValid) return null;
  const days = Math.floor(apptDay.diff(today, 'days').days);
  return Number.isFinite(days) ? days : null;
}

/** Calendar hours to hold the spot based on how soon the visit is. */
export function holdSpotReleaseHours(
  appointmentStartIso: string,
  practiceTz: string,
  now: DateTime = DateTime.now(),
): number {
  const calendarDays = calendarDaysUntilAppointment(appointmentStartIso, practiceTz, now);
  if (calendarDays != null && calendarDays > 7) return 48;

  const businessDays = businessDaysUntilAppointment(appointmentStartIso, practiceTz, now);
  if (businessDays == null) return 24;
  if (businessDays <= 0) return 1;
  if (businessDays === 1) return 4;
  if (businessDays === 2) return 12;
  if (businessDays <= 7) return 24;
  return 48;
}

/** @deprecated Use {@link holdSpotReleaseHours}. */
export function holdSpotReleaseBusinessHours(
  appointmentStartIso: string,
  practiceTz: string,
  now: DateTime = DateTime.now(),
): number {
  return holdSpotReleaseHours(appointmentStartIso, practiceTz, now);
}

export function formatHoldSpotReleaseDeadline(
  deadline: DateTime,
  practiceTz: string,
): string {
  const local = deadline.setZone(practiceTz);
  if (!local.isValid) return 'xxxxx';
  return `${formatForwardBookingSmsDateLabel(local)} at ${local.toFormat('h:mm a')}`;
}

/** Client-facing hold deadline — omits year when it matches `now` (practice local). */
export function formatHoldSpotReleaseDeadlineShort(
  deadline: DateTime,
  practiceTz: string,
  now: DateTime = DateTime.now(),
): string {
  const local = deadline.setZone(practiceTz);
  if (!local.isValid) return 'xxxxx';
  const nowLocal = now.setZone(practiceTz);
  const dayLabel =
    nowLocal.isValid && local.year === nowLocal.year
      ? `${local.toFormat('EEEE, MMMM')} ${dayOfMonthWithOrdinal(local.day)}`
      : formatForwardBookingSmsDateLabel(local);
  return `${dayLabel} at ${local.toFormat('h:mm a')}`;
}

function dayOfMonthWithOrdinal(day: number): string {
  const mod100 = day % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${day}th`;
  switch (day % 10) {
    case 1:
      return `${day}st`;
    case 2:
      return `${day}nd`;
    case 3:
      return `${day}rd`;
    default:
      return `${day}th`;
  }
}

export function computeHoldSpotReleaseDeadline(
  opts: HoldSpotReleaseSmsOpts,
): DateTime | null {
  const start = opts.appointmentStartIso.trim();
  if (!start) return null;
  const now = opts.now ?? DateTime.now();
  const hours = holdSpotReleaseHours(start, opts.practiceTz, now);
  return now.setZone(opts.practiceTz).plus({ hours });
}

const HOLD_RELEASE_CLAUSE_PREFIX =
  'We will hold this spot until';
const HOLD_RELEASE_CLAUSE_SUFFIX =
  'If we do not hear back from you by then, we will release it for another client. If another time works better, let us know.';

export function buildHoldSpotReleaseClause(opts: HoldSpotReleaseSmsOpts): string | null {
  const deadline = computeHoldSpotReleaseDeadline(opts);
  if (!deadline?.isValid) return null;
  const label = formatHoldSpotReleaseDeadline(deadline, opts.practiceTz);
  return `${HOLD_RELEASE_CLAUSE_PREFIX} ${label}. ${HOLD_RELEASE_CLAUSE_SUFFIX}`;
}

export function appendHoldSpotReleaseClause(
  message: string,
  opts: HoldSpotReleaseSmsOpts,
): string {
  const clause = buildHoldSpotReleaseClause(opts);
  if (!clause) return message;
  const trimmed = message.trimEnd();
  if (trimmed.includes(HOLD_RELEASE_CLAUSE_PREFIX)) return trimmed;
  return `${trimmed} ${clause}`;
}

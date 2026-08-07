import type { DoctorMonthDay } from '../api/appointments';
import { normalizeAppointmentTypeName } from './appointmentTypeSettings';

/** Calendar labels that mark a provider as away rather than seeing patients. */
const TIME_OFF_LABELS = [
  'vacation',
  'sick',
  'pto',
  'time off',
  'day off',
  'out of office',
  'ooo',
  'holiday',
  'leave',
  'personal day',
];

/** True when an appointment type or block title marks provider time off. */
export function isTimeOffLabel(label: string | null | undefined): boolean {
  const s = normalizeAppointmentTypeName(label);
  if (!s) return false;
  return TIME_OFF_LABELS.some((needle) => s.includes(needle));
}

function spanMinutes(startIso?: string | null, endIso?: string | null): number {
  const start = Date.parse(String(startIso ?? ''));
  const end = Date.parse(String(endIso ?? ''));
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.round((end - start) / 60_000);
}

/**
 * Time-off entries covering at least this much of a day mean the provider is away.
 * Keeps a short "sick time" slot from zeroing out an otherwise normal workday.
 */
const FULL_DAY_TIME_OFF_MINUTES = 6 * 60;

/**
 * True when a doctor/month day is blocked out for time off (vacation, OOO, holiday).
 * Multi-day all-day entries span well past the threshold, so each covered day matches.
 */
export function monthDayIsTimeOff(day: DoctorMonthDay | null | undefined): boolean {
  if (!day) return false;
  let minutes = 0;
  for (const block of day.blocks ?? []) {
    if (!isTimeOffLabel(block.title)) continue;
    minutes += spanMinutes(block.startIso, block.endIso);
  }
  for (const appt of day.appts ?? []) {
    if (!isTimeOffLabel(appt.appointmentType) && !isTimeOffLabel(appt.title)) continue;
    minutes += spanMinutes(appt.startIso, appt.endIso);
  }
  return minutes >= FULL_DAY_TIME_OFF_MINUTES;
}

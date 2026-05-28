import { DateTime } from 'luxon';

/** Default appointment description when booking from routing preview. */
export function bookedAppointmentDefaultDescription(practiceTz: string): string {
  const today = DateTime.now().setZone(practiceTz);
  const dateLabel = today.isValid
    ? today.toFormat('MM/dd/yyyy')
    : DateTime.now().toFormat('MM/dd/yyyy');
  return `(Scout ${dateLabel})`;
}

/** Append `(Scout MM/dd/yyyy)` when saving a routing-booked appointment (skip if already present). */
export function appendScoutBookedDescription(
  existing: string | undefined | null,
  practiceTz: string
): string {
  const suffix = bookedAppointmentDefaultDescription(practiceTz);
  const base = (existing ?? '').trim();
  if (!base) return suffix;
  if (base.includes('(Scout')) return base;
  return `${base} ${suffix}`;
}

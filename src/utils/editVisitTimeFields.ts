import { DateTime } from 'luxon';

export function appointmentPracticeDateKey(isoUtc: string, practiceTz: string): string | null {
  const dt = DateTime.fromISO(isoUtc, { zone: 'utc' }).setZone(practiceTz);
  return dt.isValid ? dt.toISODate() : null;
}

export function toTimeLocalValue(isoUtc: string, practiceTz: string): string {
  const dt = DateTime.fromISO(isoUtc, { zone: 'utc' }).setZone(practiceTz);
  if (!dt.isValid) return '';
  return dt.toFormat('HH:mm');
}

export function formatPracticeDateLabel(dateKey: string, practiceTz: string): string {
  const dt = DateTime.fromISO(dateKey, { zone: practiceTz });
  if (!dt.isValid) return dateKey;
  return dt.toFormat('cccc, LLL d, yyyy');
}

/** Combine fixed practice-local date with HH:mm into UTC ISO. */
export function combineDateAndTimeToUtc(
  dateKey: string,
  timeLocal: string,
  practiceTz: string
): string | null {
  const trimmed = timeLocal.trim();
  if (!dateKey || !trimmed) return null;
  const dt = DateTime.fromISO(`${dateKey}T${trimmed}`, { zone: practiceTz });
  if (!dt.isValid) return null;
  return dt.toUTC().toISO();
}

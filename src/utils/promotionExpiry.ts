import { DateTime } from 'luxon';
import { DEFAULT_PRACTICE_TIMEZONE } from './practiceTimezone';

/** `YYYY-MM-DD` (practice zone) for `<input type="date">` from a stored ISO timestamp. */
export function toDateInputValue(iso?: string | null): string {
  if (!iso) return '';
  const dt = DateTime.fromISO(iso, { zone: DEFAULT_PRACTICE_TIMEZONE });
  return dt.isValid ? dt.toISODate() ?? '' : '';
}

/**
 * PAY-A6: end of the chosen day (23:59:59) in the practice zone, so a promo code
 * works through its advertised last day. Undefined when blank or invalid.
 */
export function optionalExpiresIso(dateOnly: string): string | undefined {
  const t = dateOnly.trim();
  if (!t) return undefined;
  const dt = DateTime.fromISO(t, { zone: DEFAULT_PRACTICE_TIMEZONE });
  if (!dt.isValid) return undefined;
  return dt.set({ hour: 23, minute: 59, second: 59, millisecond: 0 }).toUTC().toISO() ?? undefined;
}

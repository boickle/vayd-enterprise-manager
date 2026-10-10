import { DateTime } from 'luxon';
import { DEFAULT_PRACTICE_TIMEZONE, practiceTimeZoneOrDefault } from './practiceTimezone';

/**
 * Membership calendar day for a stored value (matches API `membershipDay`).
 * UTC midnight → that UTC calendar day; otherwise → practice-local calendar day.
 */
export function membershipCalendarDay(
  value: Date | string | null | undefined,
  zone: string = DEFAULT_PRACTICE_TIMEZONE,
): DateTime | null {
  if (value == null || value === '') return null;
  const at = DateTime.fromJSDate(value instanceof Date ? value : new Date(value), { zone: 'utc' });
  if (!at.isValid) return null;
  if (at.equals(at.startOf('day'))) return at;
  const local = at.setZone(practiceTimeZoneOrDefault(zone));
  return DateTime.utc(local.year, local.month, local.day);
}

/** Long label for a membership day, e.g. "March 1, 2027" (matches renewal emails). */
export function formatMembershipCalendarDay(
  value: Date | string | null | undefined,
  style: 'long' | 'short' = 'long',
  zone?: string,
): string {
  const day = membershipCalendarDay(value, zone);
  if (!day?.isValid) return '—';
  return style === 'short' ? day.toFormat('MMM d, yyyy') : day.toFormat('LLLL d, yyyy');
}

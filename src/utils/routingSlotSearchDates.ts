import { DateTime } from 'luxon';
import { practiceTimeZoneOrDefault } from './practiceTimezone';

/** YYYY-MM-DD from a date-only or date-time routing field. */
export function routingCalendarDatePart(value: string): string {
  const v = value.trim();
  return v.length >= 10 ? v.slice(0, 10) : v;
}

/** Inclusive calendar-day count between two routing date strings (practice-local days). */
export function diffRoutingDaysInclusive(aISO: string, bISO: string, practiceTz: string): number {
  const tz = practiceTimeZoneOrDefault(practiceTz);
  const a = routingCalendarDatePart(aISO);
  const b = routingCalendarDatePart(bISO);
  const aDt = DateTime.fromISO(a, { zone: tz }).startOf('day');
  const bDt = DateTime.fromISO(b, { zone: tz }).startOf('day');
  if (!aDt.isValid || !bDt.isValid) return 1;
  return Math.max(1, Math.floor(bDt.diff(aDt, 'days').days) + 1);
}

export type AdjustedRoutingSlotSearchDates = {
  startDate: string;
  endDate: string;
  numDays: number;
};

/**
 * For POST `/routing/v2` slot search: when the user picks today or a past start day,
 * bump start to now + 30 minutes in the practice zone (datetime) so same-day results
 * are not in the past. When end is before today, bump end to today (date-only).
 */
export function adjustRoutingSlotSearchDates(
  startDate: string,
  endDate: string,
  practiceTz: string
): AdjustedRoutingSlotSearchDates {
  const tz = practiceTimeZoneOrDefault(practiceTz);
  const now = DateTime.now().setZone(tz);
  const today = now.toISODate()!;

  const startCal = routingCalendarDatePart(startDate);
  const endCal = routingCalendarDatePart(endDate);

  let adjustedStart = startDate.trim();
  let adjustedEnd = endDate.trim();

  if (startCal <= today) {
    adjustedStart = now.plus({ minutes: 30 }).toFormat("yyyy-MM-dd'T'HH:mm:ss");
  }

  if (endCal < today) {
    adjustedEnd = today;
  }

  const numDays = diffRoutingDaysInclusive(adjustedStart, adjustedEnd, tz);

  return { startDate: adjustedStart, endDate: adjustedEnd, numDays };
}

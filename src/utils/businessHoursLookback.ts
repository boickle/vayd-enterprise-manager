import { DateTime } from 'luxon';
import {
  CHAT_DAY_NAMES,
  parseChatHoursOfOperation,
  parseTimeToMinutes,
  type ChatHoursOfOperation,
} from './chatHours';
import { practiceTimeZoneOrDefault } from './practiceTimezone';

/** Mon–Fri 8–5 when practice hours-of-operation are unset / all closed. */
export function defaultBusinessHoursOfOperation(): ChatHoursOfOperation {
  return {
    sunday: null,
    monday: { open: '08:00', close: '17:00' },
    tuesday: { open: '08:00', close: '17:00' },
    wednesday: { open: '08:00', close: '17:00' },
    thursday: { open: '08:00', close: '17:00' },
    friday: { open: '08:00', close: '17:00' },
    saturday: null,
  };
}

function openMinutesForDay(
  hours: ChatHoursOfOperation,
  dayName: (typeof CHAT_DAY_NAMES)[number],
): number {
  const day = hours[dayName];
  if (!day?.open || !day?.close) return 0;
  const open = parseTimeToMinutes(day.open);
  let close = parseTimeToMinutes(day.close);
  if (close <= open) close += 24 * 60;
  return Math.max(0, close - open);
}

function hasAnyOpenDay(hours: ChatHoursOfOperation): boolean {
  return CHAT_DAY_NAMES.some((day) => openMinutesForDay(hours, day) > 0);
}

/**
 * Walk backward from `asOf` counting only practice-open minutes until
 * `businessHours` of open time have elapsed. Returns the UTC Instant cutoff.
 */
export function cutoffAfterBusinessHoursAgo(args: {
  businessHours: number;
  hoursOfOperation?: ChatHoursOfOperation | null;
  timeZone?: string | null;
  asOf?: Date;
}): Date {
  const needed = Math.max(0, Number(args.businessHours) || 0) * 60;
  const zone = practiceTimeZoneOrDefault(args.timeZone);
  let hours = parseChatHoursOfOperation(args.hoursOfOperation);
  if (!hasAnyOpenDay(hours)) hours = defaultBusinessHoursOfOperation();

  let cursor = DateTime.fromJSDate(args.asOf ?? new Date(), { zone });
  if (!cursor.isValid) cursor = DateTime.now().setZone(zone);
  let remaining = needed;

  // Cap at ~90 calendar days so a misconfigured schedule cannot hang.
  for (let guard = 0; guard < 90 * 24 * 60 && remaining > 0; guard += 1) {
    // Luxon weekday: 1=Mon … 7=Sun. CHAT_DAY_NAMES[0]=Sunday.
    const luxonToChat = cursor.weekday === 7 ? 0 : cursor.weekday;
    const name = CHAT_DAY_NAMES[luxonToChat];
    const day = hours[name];
    if (!day?.open || !day?.close) {
      cursor = cursor.startOf('day').minus({ minutes: 1 });
      continue;
    }

    const openMin = parseTimeToMinutes(day.open);
    let closeMin = parseTimeToMinutes(day.close);
    if (closeMin <= openMin) closeMin += 24 * 60;

    const dayStart = cursor.startOf('day');
    const openAt = dayStart.plus({ minutes: openMin });
    const closeAt = dayStart.plus({ minutes: closeMin });
    const windowEnd = cursor < closeAt ? cursor : closeAt;
    if (windowEnd <= openAt) {
      cursor = openAt.minus({ minutes: 1 });
      continue;
    }

    const available = Math.floor(windowEnd.diff(openAt, 'minutes').minutes);
    if (available <= 0) {
      cursor = openAt.minus({ minutes: 1 });
      continue;
    }

    if (remaining <= available) {
      return windowEnd.minus({ minutes: remaining }).toUTC().toJSDate();
    }
    remaining -= available;
    cursor = openAt.minus({ minutes: 1 });
  }

  return cursor.toUTC().toJSDate();
}

export function invoiceInLookback(
  paidAt: string | Date | null | undefined,
  cutoff: Date,
): boolean {
  if (paidAt == null) return false;
  const ms = typeof paidAt === 'string' ? Date.parse(paidAt) : paidAt.getTime();
  if (!Number.isFinite(ms)) return false;
  return ms >= cutoff.getTime();
}

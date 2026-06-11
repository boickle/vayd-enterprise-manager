import { DateTime } from 'luxon';
import type { ForwardBookingEntry } from '../api/forwardBooking';
import { practiceTimeZoneOrDefault } from './practiceTimezone';

export type ForwardBookingBookLaterQuickPick = {
  id: string;
  label: string;
  ymd: string;
};

function parseBookAfterDay(
  iso: string,
  practiceTz: string
): DateTime | null {
  const tz = practiceTimeZoneOrDefault(practiceTz);
  const trimmed = iso.trim();
  if (!trimmed) return null;
  const day = /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
    ? DateTime.fromISO(trimmed, { zone: tz }).startOf('day')
    : DateTime.fromISO(trimmed, { zone: 'utc' }).setZone(tz).startOf('day');
  return day.isValid ? day : null;
}

export function forwardBookingBookAfterDateIso(
  entry: Pick<ForwardBookingEntry, 'bookAfterDate'>
): string | null {
  const raw = entry.bookAfterDate?.trim();
  return raw || null;
}

export function forwardBookingTodayYmd(practiceTz: string, now = DateTime.now()): string {
  return now.setZone(practiceTimeZoneOrDefault(practiceTz)).toFormat('yyyy-MM-dd');
}

export function forwardBookingTodayStartMillis(practiceTz: string, now = DateTime.now()): number {
  return now.setZone(practiceTimeZoneOrDefault(practiceTz)).startOf('day').toMillis();
}

export function forwardBookingBookAfterDayMillis(
  entry: Pick<ForwardBookingEntry, 'bookAfterDate'>,
  practiceTz: string
): number {
  const iso = forwardBookingBookAfterDateIso(entry);
  if (!iso) return Number.MAX_SAFE_INTEGER;
  const day = parseBookAfterDay(iso, practiceTz);
  return day ? day.toMillis() : Number.MAX_SAFE_INTEGER;
}

/** `bookAfterDate` is set and still after today in practice TZ (returns to queue on or before that date). */
export function forwardBookingIsBookLater(
  entry: Pick<ForwardBookingEntry, 'bookAfterDate' | 'status'>,
  practiceTz: string,
  now = DateTime.now()
): boolean {
  if (entry.status === 'removed' || entry.status === 'complete') return false;
  const iso = forwardBookingBookAfterDateIso(entry);
  if (!iso) return false;
  const bookAfterMillis = forwardBookingBookAfterDayMillis(entry, practiceTz);
  const todayMillis = forwardBookingTodayStartMillis(practiceTz, now);
  return bookAfterMillis > todayMillis;
}

export function formatForwardBookingBookAfterDate(
  iso: string | null | undefined,
  practiceTz: string
): string {
  if (!iso?.trim()) return '—';
  const day = parseBookAfterDay(iso, practiceTz);
  if (!day) return '—';
  return day.toFormat('EEE, MMM d, yyyy');
}

export function forwardBookingBookLaterQuickPicks(practiceTz: string): ForwardBookingBookLaterQuickPick[] {
  const tz = practiceTimeZoneOrDefault(practiceTz);
  const today = DateTime.now().setZone(tz).startOf('day');
  return [
    { id: '1w', label: '1 week', ymd: today.plus({ weeks: 1 }).toFormat('yyyy-MM-dd') },
    { id: '1m', label: '1 month', ymd: today.plus({ months: 1 }).toFormat('yyyy-MM-dd') },
    { id: '3m', label: '3 months', ymd: today.plus({ months: 3 }).toFormat('yyyy-MM-dd') },
  ];
}

export function compareForwardBookingBookLaterEntries(
  a: ForwardBookingEntry,
  b: ForwardBookingEntry,
  practiceTz: string,
  clientName: (entry: ForwardBookingEntry) => string
): number {
  const ta = forwardBookingBookAfterDayMillis(a, practiceTz);
  const tb = forwardBookingBookAfterDayMillis(b, practiceTz);
  if (ta !== tb) return ta - tb;
  return clientName(a).localeCompare(clientName(b), undefined, { sensitivity: 'base' });
}

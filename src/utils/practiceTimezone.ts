import { DateTime } from 'luxon';

/** Fallback when API omits timezone (matches doctor-month client default). */
export const DEFAULT_PRACTICE_TIMEZONE = 'America/New_York';

export function practiceTimeZoneOrDefault(tz: string | null | undefined): string {
  const t = typeof tz === 'string' ? tz.trim() : '';
  return t || DEFAULT_PRACTICE_TIMEZONE;
}

/** Format an instant as locale time-of-day in the practice zone (Luxon TIME_SIMPLE). */
export function formatIsoInPracticeZone(iso: string | null | undefined, practiceTz: string): string {
  if (!iso) return '';
  const dt = DateTime.fromISO(iso);
  if (!dt.isValid) return '';
  return dt.setZone(practiceTimeZoneOrDefault(practiceTz)).toLocaleString(DateTime.TIME_SIMPLE);
}

/** Short time string in practice zone (matches `toFormat('t')` style). */
export function formatIsoTimeShortInPracticeZone(iso: string | null | undefined, practiceTz: string): string {
  if (!iso) return '';
  const dt = DateTime.fromISO(iso);
  if (!dt.isValid) return '';
  return dt.setZone(practiceTimeZoneOrDefault(practiceTz)).toFormat('t');
}

/** Instant for wall-clock `gridStartMinutesFromMidnight` on `dateIso` in practice zone. */
export function dayWallClockStartIso(
  dateIso: string,
  gridStartMinutesFromMidnight: number,
  practiceTz: string
): string {
  const tz = practiceTimeZoneOrDefault(practiceTz);
  const h = Math.floor(gridStartMinutesFromMidnight / 60);
  const m = gridStartMinutesFromMidnight % 60;
  return DateTime.fromISO(dateIso, { zone: tz })
    .set({ hour: h, minute: m, second: 0, millisecond: 0 })
    .toISO()!;
}

/** Interpret `HH:mm` / `HH:mm:ss` on `dateIso` as practice-local wall time; return short formatted time. */
export function formatDepotWallClockOnDate(
  timeStr: string | null | undefined,
  dateIso: string,
  practiceTz: string
): string | null {
  const raw = timeStr?.trim();
  if (!raw) return null;
  const isoTime = raw.split(':').length === 2 ? `${raw}:00` : raw;
  const dt = DateTime.fromISO(`${dateIso}T${isoTime}`, { zone: practiceTimeZoneOrDefault(practiceTz) });
  if (!dt.isValid) return raw;
  return dt.toFormat('t');
}

/** Seconds after midnight on `dateIso` in practice zone → absolute ISO. */
export function isoFromSecondsSincePracticeMidnight(
  dateIso: string,
  secFromMidnight: number,
  practiceTz: string
): string | null {
  if (!Number.isFinite(secFromMidnight) || secFromMidnight < 0) return null;
  const d = DateTime.fromISO(dateIso, { zone: practiceTimeZoneOrDefault(practiceTz) });
  if (!d.isValid) return null;
  return d.startOf('day').plus({ seconds: Math.round(secFromMidnight) }).toISO()!;
}

/**
 * Calendar date (YYYY-MM-DD) of an instant in the practice zone. A result stamped 9:30 pm Eastern
 * is that evening's date, not the next UTC day. Date-only strings are returned as written.
 */
export function practiceDateKey(
  value: string | null | undefined,
  practiceTz?: string | null
): string | null {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const dt = DateTime.fromISO(raw).setZone(practiceTimeZoneOrDefault(practiceTz));
  return dt.isValid ? dt.toISODate() : null;
}

/**
 * Last instant of a calendar day (YYYY-MM-DD, as a date input gives it) in the practice zone, as an
 * ISO string: 23:59:59.999 on that day, with the offset in force that day (daylight or standard time).
 */
export function endOfPracticeDayIso(
  dateYmd: string | null | undefined,
  practiceTz?: string | null
): string | null {
  const raw = typeof dateYmd === 'string' ? dateYmd.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const dt = DateTime.fromISO(raw, { zone: practiceTimeZoneOrDefault(practiceTz) });
  return dt.isValid ? dt.endOf('day').toISO() : null;
}

/** Calendar date of an instant in the practice zone, formatted M/d/yyyy (e.g. 11/30/2026). */
export function formatPracticeDate(
  iso: string | null | undefined,
  practiceTz?: string | null
): string {
  const raw = typeof iso === 'string' ? iso.trim() : '';
  if (!raw) return '';
  const dt = DateTime.fromISO(raw).setZone(practiceTimeZoneOrDefault(practiceTz));
  return dt.isValid ? dt.toFormat('M/d/yyyy') : '';
}

/**
 * The practice's calendar date (YYYY-MM-DD) for an instant, or for now. Not the UTC date: an evening call in New York
 * is still that day, though UTC has already moved on to the next.
 */
export function ymdInPracticeZone(iso?: string | null, practiceTz?: string | null): string {
  const tz = practiceTimeZoneOrDefault(practiceTz);
  const at = iso ? DateTime.fromISO(iso) : null;
  return (at?.isValid ? at : DateTime.now()).setZone(tz).toISODate()!;
}

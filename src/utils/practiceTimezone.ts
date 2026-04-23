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

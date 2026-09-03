import { DateTime } from 'luxon';
import { practiceTimeZoneOrDefault } from './practiceTimezone';

/** Default practice leave-depot clock when schedule omits startDepotTime. */
export const DEFAULT_START_DEPOT_HMM = '08:30';

/**
 * Interpret `HH:mm` / `HH:mm:ss` (or a full ISO) on `dateIso` as practice-local wall time.
 */
export function depotWallClockIsoOnDate(
  dateIso: string,
  timeStr: string | null | undefined,
  practiceTz: string,
  fallbackHmm: string = DEFAULT_START_DEPOT_HMM
): string | null {
  const tz = practiceTimeZoneOrDefault(practiceTz);
  const raw = (timeStr ?? '').trim() || fallbackHmm;
  if (DateTime.fromISO(raw).isValid && raw.includes('T')) {
    const asIso = DateTime.fromISO(raw, { zone: 'utc' }).setZone(tz);
    return asIso.isValid ? asIso.toISO() : null;
  }
  const isoTime = raw.split(':').length === 2 ? `${raw}:00` : raw;
  const dt = DateTime.fromISO(`${dateIso}T${isoTime}`, { zone: tz });
  return dt.isValid ? dt.toISO() : null;
}

/**
 * Early-day first-stop rule (product / PR #291):
 * If expectedArrival − 1h is before start-depot time, the client window is
 * [expectedArrival, expectedArrival + 2h] — not type ±1h and not depot-leave→+2h.
 *
 * Returns null when the rewrite does not apply (caller should keep type ±N / API window).
 */
export function earlyDayArrivalWindowFromExpectedArrival(opts: {
  dateIso: string;
  practiceTz: string;
  startDepotTime?: string | null;
  /** ETA / expected arrival (or scheduled start when ETA is unknown). */
  expectedArrivalIso: string;
}): { startIso: string; endIso: string } | null {
  const tz = practiceTimeZoneOrDefault(opts.practiceTz);
  const eta = DateTime.fromISO(opts.expectedArrivalIso, { zone: 'utc' }).setZone(tz);
  if (!eta.isValid) return null;

  const depotIso = depotWallClockIsoOnDate(opts.dateIso, opts.startDepotTime, tz);
  if (!depotIso) return null;
  const depot = DateTime.fromISO(depotIso, { zone: 'utc' }).setZone(tz);
  if (!depot.isValid) return null;

  if (eta.minus({ hours: 1 }) >= depot) return null;

  const end = eta.plus({ hours: 2 });
  const startIso = eta.toUTC().toISO();
  const endIso = end.toUTC().toISO();
  if (!startIso || !endIso) return null;
  return { startIso, endIso };
}

/**
 * Visual / fallback window when API `effectiveWindow` is missing.
 * Applies the early-day ETA→ETA+2h rewrite when it fires; otherwise type ±N
 * with window start floored at depot leave (legacy Doctor Day behavior).
 */
export function adjustedArrivalWindowForScheduledStart(opts: {
  dateIso: string;
  scheduledStartIso: string;
  practiceTz: string;
  startDepotTime?: string | null;
  /** Prefer routed ETA when known so first-stop windows follow expected arrival. */
  expectedArrivalIso?: string | null;
  beforeMinutes?: number;
  afterMinutes?: number;
}): { startIso: string; endIso: string } | null {
  const tz = practiceTimeZoneOrDefault(opts.practiceTz);
  const scheduled = DateTime.fromISO(opts.scheduledStartIso, { zone: 'utc' }).setZone(tz);
  if (!scheduled.isValid) return null;

  const anchorIso = opts.expectedArrivalIso?.trim() || opts.scheduledStartIso;
  const rewritten = earlyDayArrivalWindowFromExpectedArrival({
    dateIso: opts.dateIso,
    practiceTz: tz,
    startDepotTime: opts.startDepotTime,
    expectedArrivalIso: anchorIso,
  });
  if (rewritten) return rewritten;

  const before = opts.beforeMinutes != null && Number.isFinite(opts.beforeMinutes) && opts.beforeMinutes >= 0
    ? opts.beforeMinutes
    : 60;
  const after = opts.afterMinutes != null && Number.isFinite(opts.afterMinutes) && opts.afterMinutes >= 0
    ? opts.afterMinutes
    : 60;

  const depotIso = depotWallClockIsoOnDate(opts.dateIso, opts.startDepotTime, tz);
  const depot = depotIso
    ? DateTime.fromISO(depotIso, { zone: 'utc' }).setZone(tz)
    : null;

  const rawStart = scheduled.minus({ minutes: before });
  const ws = depot?.isValid ? DateTime.max(depot, rawStart) : rawStart;
  const we = scheduled.plus({ minutes: after });
  const startIso = ws.toUTC().toISO();
  const endIso = we.toUTC().toISO();
  if (!startIso || !endIso) return null;
  return { startIso, endIso };
}

/**
 * Prefer early-day rewrite for the day's first routable stop when ETA is known.
 * Used to correct displays that still show depot-leave–clamped ±1h (e.g. 8:30–10)
 * instead of expected-arrival → +2h (e.g. 9–11).
 */
export function resolveFirstStopEarlyDayArrivalWindow(opts: {
  dateIso: string;
  practiceTz: string;
  startDepotTime?: string | null;
  expectedArrivalIso?: string | null;
  scheduledStartIso?: string | null;
  isFirstRoutableStop: boolean;
}): { startIso: string; endIso: string } | null {
  if (!opts.isFirstRoutableStop) return null;
  const anchor = opts.expectedArrivalIso?.trim() || opts.scheduledStartIso?.trim() || '';
  if (!anchor) return null;
  return earlyDayArrivalWindowFromExpectedArrival({
    dateIso: opts.dateIso,
    practiceTz: opts.practiceTz,
    startDepotTime: opts.startDepotTime,
    expectedArrivalIso: anchor,
  });
}

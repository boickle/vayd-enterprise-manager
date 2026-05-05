import { DateTime } from 'luxon';

/** ETA within this many minutes of window end (or past end) triggers "Window Warning". */
export const WINDOW_WARNING_MINUTES_FROM_END = 17;

/**
 * Client Fixed Time: route ETA may trail booked start by a few seconds (rounding, map engine).
 * Within this many seconds after `startIso`, we still treat the stop as on the calendar anchor
 * (no route-clock slip, no Fixed Time "pushed off schedule" window warning).
 */
export const FIXED_TIME_ETA_SLIP_TOLERANCE_SECONDS = 60;

/** True when ETA is meaningfully after booked start (beyond {@link FIXED_TIME_ETA_SLIP_TOLERANCE_SECONDS}). */
export function fixedTimeRouteEtaMeaningfullyAfterScheduledStart(
  schedStartIso: string | null | undefined,
  etaIso: string | null | undefined,
  toleranceSec: number = FIXED_TIME_ETA_SLIP_TOLERANCE_SECONDS
): boolean {
  if (!schedStartIso?.trim() || !etaIso?.trim()) return false;
  const sched = DateTime.fromISO(schedStartIso);
  const eta = DateTime.fromISO(etaIso);
  if (!sched.isValid || !eta.isValid) return false;
  const secAfter = eta.diff(sched, 'seconds').seconds;
  return secAfter > toleranceSec;
}

/**
 * True when projected ETA is less than WINDOW_WARNING_MINUTES_FROM_END minutes before window end,
 * or at/after window end (minutes remaining less than threshold).
 */
export function shouldShowEtaWindowWarning(
  etaIso: string | null | undefined,
  windowEndIso: string | null | undefined
): boolean {
  if (!etaIso?.trim() || !windowEndIso?.trim()) return false;
  const eta = DateTime.fromISO(etaIso);
  const wEnd = DateTime.fromISO(windowEndIso);
  if (!eta.isValid || !wEnd.isValid) return false;
  const minutesRemaining = wEnd.diff(eta, 'minutes').minutes;
  return minutesRemaining < WINDOW_WARNING_MINUTES_FROM_END;
}

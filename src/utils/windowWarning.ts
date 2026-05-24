import { DateTime } from 'luxon';

/**
 * ETA within this many minutes of window end (or past end) triggers "Window Warning".
 * Keep aligned with routing scorer window-edge / downstreamWindowEdge threshold (backend).
 */
export const WINDOW_WARNING_MINUTES_FROM_END = 20;

/**
 * Client Fixed Time: route ETA may trail booked start by a few seconds (rounding, map engine).
 * Within this many seconds after `startIso`, we still treat the stop as on the calendar anchor
 * (layout may use ETA when slipped; window warnings use arrival window when available).
 */
export const FIXED_TIME_ETA_SLIP_TOLERANCE_SECONDS = 60;

/**
 * Client Fixed Time: use doctor-day booked start/end for drive layout only when there is no
 * arrival window from type settings and routing has not slipped past booked start.
 * When `windowStartIso` + `windowEndIso` exist (±N from appointment type), use routed ETA/ETD.
 */
export function clientFixedTimeUsesDoctorDayClockForDriveLayout(opts: {
  schedStartIso?: string | null;
  etaIso?: string | null;
  windowStartIso?: string | null;
  windowEndIso?: string | null;
}): boolean {
  const windowStart = opts.windowStartIso?.trim();
  const windowEnd = opts.windowEndIso?.trim();
  if (windowStart && windowEnd) return false;

  const schedStart = opts.schedStartIso?.trim();
  const eta = opts.etaIso?.trim();
  if (!eta || !schedStart) return true;
  if (fixedTimeRouteEtaMeaningfullyAfterScheduledStart(schedStart, eta)) return false;
  return true;
}

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

/**
 * Window warning for drive-time views (Scheduler, My Week, Doctor Day Visual).
 * Uses arrival-window end from appointment type settings when present (including Fixed Time ±N min).
 * Falls back to "ETA after booked start" only for client Fixed Time with no window metadata.
 */
export function computeDriveTimeWindowWarning(opts: {
  etaIso: string | null | undefined;
  windowEndIso: string | null | undefined;
  isClientFixedTime: boolean;
  scheduledStartIso?: string | null | undefined;
}): boolean {
  const eta = opts.etaIso?.trim();
  if (!eta) return false;

  const windowEnd = opts.windowEndIso?.trim();
  if (windowEnd) {
    return shouldShowEtaWindowWarning(eta, windowEnd);
  }

  if (opts.isClientFixedTime && opts.scheduledStartIso?.trim()) {
    return fixedTimeRouteEtaMeaningfullyAfterScheduledStart(opts.scheduledStartIso, eta);
  }

  return false;
}

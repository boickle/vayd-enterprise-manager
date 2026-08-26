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
 * True when start/end form a zero-width (or inverted) arrival window — i.e. Fixed Time /
 * HOLD–In Office with windowBefore=windowAfter=0. Not the same as a missing window.
 */
export function arrivalWindowIsZeroWidth(
  windowStartIso?: string | null,
  windowEndIso?: string | null
): boolean {
  const start = windowStartIso?.trim();
  const end = windowEndIso?.trim();
  if (!start || !end) return false;
  const wStart = DateTime.fromISO(start);
  const wEnd = DateTime.fromISO(end);
  if (!wStart.isValid || !wEnd.isValid) return false;
  return wEnd.diff(wStart, 'minutes').minutes <= 0;
}

/**
 * Client Fixed Time / zero-window visits: use doctor-day booked start/end for drive layout
 * when there is no *flexible* arrival window and routing has not slipped past booked start.
 * Positive-width windows (±N from appointment type) follow routed ETA/ETD.
 * Zero-width windows (0±0) are treated as no arrival flexibility — same as missing window.
 */
export function clientFixedTimeUsesDoctorDayClockForDriveLayout(opts: {
  schedStartIso?: string | null;
  etaIso?: string | null;
  windowStartIso?: string | null;
  windowEndIso?: string | null;
}): boolean {
  const windowStart = opts.windowStartIso?.trim();
  const windowEnd = opts.windowEndIso?.trim();
  // Real (positive-width) arrival windows follow routed ETA/ETD.
  if (windowStart && windowEnd && !arrivalWindowIsZeroWidth(windowStart, windowEnd)) {
    return false;
  }

  const schedStart = opts.schedStartIso?.trim();
  const eta = opts.etaIso?.trim();
  if (!eta || !schedStart) return true;
  if (fixedTimeRouteEtaMeaningfullyAfterScheduledStart(schedStart, eta)) return false;
  return true;
}

/**
 * Pin Routed-timeline layout to booked clock for named Fixed Time **or** intentional
 * zero-width windows (HOLD – In Office / Fixed Time 0±0). Otherwise ETA may reorder a
 * late-day office stop above an earlier windowed field visit.
 */
export function clientVisitUsesDoctorDayClockForDriveLayout(opts: {
  isClientFixedTime: boolean;
  schedStartIso?: string | null;
  etaIso?: string | null;
  windowStartIso?: string | null;
  windowEndIso?: string | null;
}): boolean {
  const zeroWidth = arrivalWindowIsZeroWidth(opts.windowStartIso, opts.windowEndIso);
  if (!opts.isClientFixedTime && !zeroWidth) return false;
  return clientFixedTimeUsesDoctorDayClockForDriveLayout({
    schedStartIso: opts.schedStartIso,
    etaIso: opts.etaIso,
    windowStartIso: opts.windowStartIso,
    windowEndIso: opts.windowEndIso,
  });
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
 * True when projected ETA is within WINDOW_WARNING_MINUTES_FROM_END minutes of window end
 * (inclusive), or at/after window end (minutes remaining ≤ threshold).
 *
 * "Within 20 minutes" includes the exact boundary — e.g. ETA 12:15 with window end 12:35 warns.
 *
 * Zero-width windows (fixed time: windowBefore=0 and windowAfter=0) only warn when ETA is
 * meaningfully after the window end — not when arrival is on time at the scheduled instant.
 */
export function shouldShowEtaWindowWarning(
  etaIso: string | null | undefined,
  windowEndIso: string | null | undefined,
  windowStartIso?: string | null | undefined
): boolean {
  if (!etaIso?.trim() || !windowEndIso?.trim()) return false;
  const eta = DateTime.fromISO(etaIso);
  const wEnd = DateTime.fromISO(windowEndIso);
  if (!eta.isValid || !wEnd.isValid) return false;

  const windowStart = windowStartIso?.trim();
  if (windowStart) {
    const wStart = DateTime.fromISO(windowStart);
    if (wStart.isValid) {
      const windowMinutes = wEnd.diff(wStart, 'minutes').minutes;
      if (windowMinutes <= 0) {
        return fixedTimeRouteEtaMeaningfullyAfterScheduledStart(windowEndIso, etaIso);
      }
    }
  }

  const minutesRemaining = wEnd.diff(eta, 'minutes').minutes;
  return minutesRemaining <= WINDOW_WARNING_MINUTES_FROM_END;
}

/**
 * Window warning for drive-time views (Scheduler, My Week, Doctor Day Visual).
 * Uses arrival-window end from appointment type settings when present (including Fixed Time ±N min).
 * Falls back to "ETA after booked start" only for client Fixed Time with no window metadata.
 */
export function computeDriveTimeWindowWarning(opts: {
  etaIso: string | null | undefined;
  windowEndIso: string | null | undefined;
  windowStartIso?: string | null | undefined;
  isClientFixedTime: boolean;
  scheduledStartIso?: string | null | undefined;
}): boolean {
  const eta = opts.etaIso?.trim();
  if (!eta) return false;

  const windowEnd = opts.windowEndIso?.trim();
  if (windowEnd) {
    return shouldShowEtaWindowWarning(eta, windowEnd, opts.windowStartIso);
  }

  if (opts.isClientFixedTime && opts.scheduledStartIso?.trim()) {
    return fixedTimeRouteEtaMeaningfullyAfterScheduledStart(opts.scheduledStartIso, eta);
  }

  return false;
}

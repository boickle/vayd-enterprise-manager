/**
 * Schedule Progress (reconcile modal): project Actual-column times when the doctor
 * is still at a visit (arrive recorded, leave not yet).
 *
 * Without this, Actual falls back to the scheduled/predicted end and shortens the
 * in-progress stop — hiding how late the rest of the day will run.
 */
import { DateTime } from 'luxon';

export type ProgressVisitActualInput = {
  /** Predicted/routed arrive (ETA or calendar start). */
  predictedStartIso: string | null;
  /** Predicted/routed leave (ETD or calendar end). */
  predictedEndIso: string | null;
  /** Recorded arrive; null when not yet started. */
  actualStartIso: string | null;
  /** Recorded leave; null when still on site (or not recorded). */
  actualEndIso: string | null;
};

export type ProgressVisitProjected = {
  startIso: string | null;
  endIso: string | null;
  /** True when leave was projected from arrive + predicted duration (not recorded). */
  projectedLeave: boolean;
};

function parseIso(iso: string | null | undefined): DateTime | null {
  const raw = iso?.trim();
  if (!raw) return null;
  const dt = DateTime.fromISO(raw, { setZone: true });
  return dt.isValid ? dt : null;
}

/** Predicted on-site minutes; falls back to 60 when bounds are missing/invalid. */
export function predictedServiceMinutes(
  predictedStartIso: string | null,
  predictedEndIso: string | null,
  fallbackMinutes = 60
): number {
  const start = parseIso(predictedStartIso);
  const end = parseIso(predictedEndIso);
  if (start && end) {
    const mins = end.diff(start, 'minutes').minutes;
    if (Number.isFinite(mins) && mins > 0) return Math.max(1, Math.round(mins));
  }
  return Math.max(1, Math.floor(fallbackMinutes));
}

/**
 * Walk visits in display/route order. Completed actuals stay as recorded.
 * In-progress (arrive only) keeps full predicted duration from actual arrive.
 * Later stops without recorded times shift by the running leave delay so the
 * remainder of the day reflects the in-progress overrun.
 */
export function projectScheduleProgressActualVisits(
  visits: readonly ProgressVisitActualInput[]
): { visits: ProgressVisitProjected[]; leaveDelayMs: number } {
  let leaveDelayMs = 0;
  const out: ProgressVisitProjected[] = [];

  for (const v of visits) {
    const predictedStart = parseIso(v.predictedStartIso);
    const predictedEnd = parseIso(v.predictedEndIso);
    const actualStart = parseIso(v.actualStartIso);
    const actualEnd = parseIso(v.actualEndIso);
    const durationMin = predictedServiceMinutes(v.predictedStartIso, v.predictedEndIso);

    if (actualStart && actualEnd) {
      out.push({
        startIso: actualStart.toUTC().toISO(),
        endIso: actualEnd.toUTC().toISO(),
        projectedLeave: false,
      });
      if (predictedEnd) {
        leaveDelayMs = actualEnd.diff(predictedEnd).as('milliseconds');
      }
      continue;
    }

    if (actualStart && !actualEnd) {
      const projectedEnd = actualStart.plus({ minutes: durationMin });
      out.push({
        startIso: actualStart.toUTC().toISO(),
        endIso: projectedEnd.toUTC().toISO(),
        projectedLeave: true,
      });
      if (predictedEnd) {
        leaveDelayMs = projectedEnd.diff(predictedEnd).as('milliseconds');
      } else if (predictedStart) {
        // No predicted end: delay from arrive vs predicted arrive (duration preserved).
        leaveDelayMs = actualStart.diff(predictedStart).as('milliseconds');
      }
      continue;
    }

    // Not started: shift predicted bounds by running leave delay from earlier stops.
    if (predictedStart && predictedEnd) {
      const start = predictedStart.plus({ milliseconds: leaveDelayMs });
      const end = predictedEnd.plus({ milliseconds: leaveDelayMs });
      out.push({
        startIso: start.toUTC().toISO(),
        endIso: end.toUTC().toISO(),
        projectedLeave: leaveDelayMs !== 0,
      });
      continue;
    }

    if (predictedStart) {
      const start = predictedStart.plus({ milliseconds: leaveDelayMs });
      const end = start.plus({ minutes: durationMin });
      out.push({
        startIso: start.toUTC().toISO(),
        endIso: end.toUTC().toISO(),
        projectedLeave: leaveDelayMs !== 0,
      });
      continue;
    }

    out.push({
      startIso: v.predictedStartIso,
      endIso: v.predictedEndIso,
      projectedLeave: false,
    });
  }

  return { visits: out, leaveDelayMs };
}

/** Shift an ISO instant by leaveDelayMs from {@link projectScheduleProgressActualVisits}. */
export function shiftIsoByLeaveDelay(
  iso: string | null | undefined,
  leaveDelayMs: number
): string | null {
  if (!leaveDelayMs) return iso?.trim() || null;
  const dt = parseIso(iso ?? null);
  if (!dt) return iso?.trim() || null;
  return dt.plus({ milliseconds: leaveDelayMs }).toUTC().toISO();
}

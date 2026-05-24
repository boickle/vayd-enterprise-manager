/** Compare POST `/routing/v2` candidate scores to `rescheduleOriginalBooking` (v2: lower is better). */

import type {
  RescheduleOriginalBooking,
  RescheduleOriginalVisitSnapshot,
} from '../api/routing';

export type { RescheduleOriginalBooking, RescheduleOriginalVisitSnapshot };

function formatScore(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** Visit row to compare against (anchor appointment from reschedule intent). */
export function resolveOriginalVisitForScoreCompare(
  booking: RescheduleOriginalBooking | null | undefined,
  anchorAppointmentId: number | null | undefined
): RescheduleOriginalVisitSnapshot | null {
  if (!booking?.visits?.length || anchorAppointmentId == null) return null;
  return (
    booking.visits.find((v) => v.appointmentId === anchorAppointmentId) ??
    booking.visits[0] ??
    null
  );
}

/**
 * Header suffix for routing result cards during reschedule, e.g.
 * `(Score: 74.2 · was 86.8, −12.6 better)`.
 */
export function rescheduleScoreHeaderSuffix(
  candidateScore: number | undefined,
  originalVisit: RescheduleOriginalVisitSnapshot | null | undefined
): string | null {
  if (typeof candidateScore !== 'number' || !Number.isFinite(candidateScore)) return null;

  const newLabel = formatScore(candidateScore);
  if (!originalVisit?.found || typeof originalVisit.score !== 'number' || !Number.isFinite(originalVisit.score)) {
    return `(Score: ${newLabel} · no previous score available)`;
  }

  const was = originalVisit.score;
  const delta = candidateScore - was;
  const wasLabel = formatScore(was);

  if (Math.abs(delta) < 0.05) {
    return `(Score: ${newLabel} · was ${wasLabel}, unchanged)`;
  }

  const magnitude = formatScore(Math.abs(delta));
  if (delta > 0) {
    return `(Score: ${newLabel} · was ${wasLabel}, +${magnitude} worse)`;
  }
  return `(Score: ${newLabel} · was ${wasLabel}, −${magnitude} better)`;
}

/** One-line summary for the results panel when the original snapshot exists. */
export function rescheduleOriginalScoreSummary(
  originalVisit: RescheduleOriginalVisitSnapshot | null | undefined
): string | null {
  if (!originalVisit) return null;
  if (!originalVisit.found || typeof originalVisit.score !== 'number' || !Number.isFinite(originalVisit.score)) {
    return 'No previous routing score available for this visit.';
  }
  return `Original booking score: ${formatScore(originalVisit.score)} (lower is better).`;
}

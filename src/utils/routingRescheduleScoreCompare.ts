/** Compare POST `/routing/v2` candidate scores to `rescheduleOriginalBooking` (v2: lower is better). */

import { DateTime } from 'luxon';
import type {
  RescheduleOriginalBooking,
  RescheduleOriginalVisitSnapshot,
} from '../api/routing';
import { fetchTimeChangePreview } from '../api/routing';
import {
  patchRescheduleIntentSourcePlacementSnapshot,
  type RoutingRescheduleIntentV1,
} from './routingRescheduleIntent';
import {
  formatInPlacePreviewScoreChangePercent,
  formatInPlaceScoreDeltaPercentLabel,
} from './editVisitInPlaceScoreCompare';

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

function originalVisitHasScore(
  visit: RescheduleOriginalVisitSnapshot | null | undefined
): visit is RescheduleOriginalVisitSnapshot & { score: number } {
  return (
    visit?.found === true &&
    typeof visit.score === 'number' &&
    Number.isFinite(visit.score)
  );
}

/**
 * Prefer POST `/routing/v2` `rescheduleOriginalBooking` when the search doctor owns the visit;
 * otherwise fall back to the source doctor snapshot cached on the reschedule intent.
 */
export function resolveRescheduleOriginalVisitForCompare(
  booking: RescheduleOriginalBooking | null | undefined,
  anchorAppointmentId: number | null | undefined,
  intent: RoutingRescheduleIntentV1 | null | undefined
): RescheduleOriginalVisitSnapshot | null {
  const fromApi = resolveOriginalVisitForScoreCompare(booking, anchorAppointmentId);
  if (originalVisitHasScore(fromApi)) return fromApi;

  const cached = intent?.sourcePlacementVisitSnapshot;
  if (originalVisitHasScore(cached)) return cached;

  return cached ?? fromApi;
}

function intentOriginalEndIso(intent: RoutingRescheduleIntentV1): string | null {
  const explicit = intent.originalEndIso?.trim();
  if (explicit) return explicit;
  const start = intent.originalStartIso?.trim();
  if (!start) return null;
  const minutes = intent.serviceMinutes;
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  const dt = DateTime.fromISO(start);
  if (!dt.isValid) return null;
  return dt.toISO({ includeOffset: true }) ?? null;
}

/** Score the visit at its current slot on the source doctor's route (cross-doctor reschedule baseline). */
export async function fetchAndCacheRescheduleSourcePlacementSnapshot(
  intent: RoutingRescheduleIntentV1
): Promise<RescheduleOriginalVisitSnapshot | null> {
  const cached = intent.sourcePlacementVisitSnapshot;
  if (originalVisitHasScore(cached)) return cached;

  const doctorId = intent.sourceDoctorPimsId?.trim() ?? intent.primaryDoctorPimsId?.trim();
  const date = intent.practiceDateKey?.trim();
  const start = intent.originalStartIso?.trim();
  const end = intentOriginalEndIso(intent);
  if (!doctorId || !date || !start || !end) return null;

  try {
    const preview = await fetchTimeChangePreview({
      doctorId,
      date,
      appointmentId: intent.appointmentId,
      newAppointmentStartIso: start,
      newAppointmentEndIso: end,
      useTraffic: true,
    });
    const orig = preview.original;
    const snapshot: RescheduleOriginalVisitSnapshot = {
      appointmentId: intent.appointmentId,
      found: orig?.found ?? false,
      score:
        orig?.found && typeof orig.score === 'number' && Number.isFinite(orig.score)
          ? orig.score
          : undefined,
      prefScore: orig?.prefScore ?? undefined,
      suggestedStartIso: orig?.suggestedStartIso ?? start,
      date,
      doctorPimsId: doctorId,
      routingRequestId: orig?.routingRequestId ?? undefined,
    };
    patchRescheduleIntentSourcePlacementSnapshot(snapshot);
    return originalVisitHasScore(snapshot) ? snapshot : null;
  } catch {
    return null;
  }
}

/** Popover body line — same wording as edit visit time/type preview. */
export function formatReschedulePreviewScoreLine(
  candidateScore: number,
  originalVisit: RescheduleOriginalVisitSnapshot | null | undefined
): string | null {
  if (!originalVisit?.found || typeof originalVisit.score !== 'number' || !Number.isFinite(originalVisit.score)) {
    return 'No previous routing score available for this visit.';
  }
  const delta = candidateScore - originalVisit.score;
  return formatInPlacePreviewScoreChangePercent(originalVisit.score, delta);
}

/**
 * Header suffix for routing result cards during reschedule, e.g.
 * `(Score: 74.2 · was 86.8, −14.4% better)`.
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
  const changeLabel = formatInPlaceScoreDeltaPercentLabel(was, delta);

  if (changeLabel === 'unchanged') {
    return `(Score: ${newLabel} · was ${wasLabel}, unchanged)`;
  }

  return `(Score: ${newLabel} · was ${wasLabel}, ${changeLabel})`;
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

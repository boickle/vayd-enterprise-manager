import type { TypeChangeFeedbackHandoff, TypeChangePreviewScoreSnapshot } from '../api/routing';
import {
  feedbackHandoffFromPreviewResult,
  inPlacePreviewOverflowOverrunSeconds,
} from './editVisitPreviewScoreHandoff';

export type EditVisitPreviewScoreCompare = {
  originalScore: number | null;
  newScore: number | null;
  /** new − original from preview API (positive = worse). */
  delta: number | null;
  headerSuffix: string | null;
  summaryLine: string | null;
  originalScoreLine: string | null;
  newTypeUnavailableLine: string | null;
  windowLine: string | null;
  windowWarningMayChange: boolean;
  arrivalWindowAfter: { startIso: string; endIso: string } | null;
  withNewTypeFeasible: boolean | null;
  withNewTypeReason: string | null;
  downstreamWindowEdge: number | null;
  overflowOverrunSeconds: number | null;
  feedbackHandoff: TypeChangeFeedbackHandoff | null;
};

export function humanizeInPlaceReason(
  reason: string,
  context: 'type' | 'time' = 'type'
): string {
  const r = reason.trim().toLowerCase();
  switch (r) {
    case 'window-violation':
      return context === 'time'
        ? 'This time cannot be served within the arrival window at this slot.'
        : 'This type cannot be served on time at the current slot (arrival window or fixed-time violation).';
    case 'personal-block-conflict':
      return 'The visit overlaps a personal block at this time.';
    case 'overtime':
      return context === 'time'
        ? 'This time would push return-to-depot past the allowed overtime.'
        : 'This type at this slot would push return-to-depot past the allowed overtime.';
    case 'drive-infeasible':
      return context === 'time'
        ? 'Drive timing is infeasible at this time on the route.'
        : 'Drive timing is infeasible at this slot with the new type.';
    default:
      return reason.trim().replace(/-/g, ' ');
  }
}

export function inPlacePreviewNewScore(
  snapshot: { found?: boolean; score?: number | null } | null | undefined
): number | null {
  if (!snapshot?.found || typeof snapshot.score !== 'number' || !Number.isFinite(snapshot.score)) {
    return null;
  }
  return snapshot.score;
}

export function formatPreviewScore(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** Compact label for score delta vs baseline, e.g. `+99.5% worse` (lower score is better). */
export function formatInPlaceScoreDeltaPercentLabel(
  originalScore: number,
  delta: number
): string {
  if (Math.abs(delta) < 0.05) return 'unchanged';
  const base = Math.abs(originalScore);
  if (!Number.isFinite(base) || base < 0.05) {
    return delta > 0 ? 'worse' : 'better';
  }
  const pct = (Math.abs(delta) / base) * 100;
  const pctLabel = pct >= 10 ? String(Math.round(pct)) : pct.toFixed(1);
  if (delta > 0) return `+${pctLabel}% worse`;
  return `−${pctLabel}% better`;
}

/** Prefer API `delta`; else new − original (lower is better; positive = worse). */
export function resolveInPlacePreviewDelta(
  originalScore: number | null,
  newScore: number | null,
  apiDelta: number | null | undefined
): number | null {
  if (typeof apiDelta === 'number' && Number.isFinite(apiDelta)) return apiDelta;
  if (originalScore != null && newScore != null) return newScore - originalScore;
  return null;
}

export function formatInPlacePreviewScoreChangePercent(
  originalScore: number,
  delta: number
): string {
  const label = formatInPlaceScoreDeltaPercentLabel(originalScore, delta);
  if (label === 'unchanged') {
    return 'This makes the scheduling score of this visit unchanged.';
  }
  if (label === 'worse') {
    return 'This makes the scheduling score of this visit worse.';
  }
  if (label === 'better') {
    return 'This makes the scheduling score of this visit better.';
  }
  return `This makes the scheduling score of this visit ${label.slice(1)}.`;
}

/** Primary score line — percent change vs in-place baseline (lower score is better). */
export function formatInPlacePreviewScoreSummaryLine(args: {
  newScore: number;
  originalScore: number | null;
  delta: number | null;
}): string {
  if (args.originalScore == null || args.delta == null) {
    return `Score: ${formatPreviewScore(args.newScore)}`;
  }
  return formatInPlacePreviewScoreChangePercent(args.originalScore, args.delta);
}

function inPlaceOriginalScore(snapshot: TypeChangePreviewScoreSnapshot): number | null {
  if (!snapshot.found || typeof snapshot.score !== 'number' || !Number.isFinite(snapshot.score)) {
    return null;
  }
  return snapshot.score;
}

export function buildEditVisitPreviewScoreCompare(args: {
  original: TypeChangePreviewScoreSnapshot;
  withNew: TypeChangePreviewScoreSnapshot;
  apiDelta: number | null | undefined;
  context: 'type' | 'time';
  apptId: number;
  feedbackHandoffRaw?: TypeChangeFeedbackHandoff | null;
  windowLine?: string | null;
  windowWarningMayChange?: boolean;
  arrivalWindowAfter?: { startIso: string; endIso: string } | null;
}): EditVisitPreviewScoreCompare {
  const {
    original,
    withNew,
    apiDelta,
    context,
    apptId,
    feedbackHandoffRaw,
    windowLine = null,
    windowWarningMayChange = false,
    arrivalWindowAfter = null,
  } = args;

  const originalScore = inPlaceOriginalScore(original);
  const newScore = inPlacePreviewNewScore(withNew);
  const delta = resolveInPlacePreviewDelta(originalScore, newScore, apiDelta);
  const isInfeasible = withNew.feasible === false;
  const withNewFeasible =
    withNew.feasible === true ? true : withNew.feasible === false ? false : null;
  const withNewReason = withNew.reason?.trim() || null;
  const downstreamEdge = withNew.scoringComponents?.downstreamWindowEdge;
  const downstreamWindowEdge =
    typeof downstreamEdge === 'number' && Number.isFinite(downstreamEdge) && downstreamEdge > 0
      ? downstreamEdge
      : null;
  const feedbackHandoff = feedbackHandoffFromPreviewResult({
    feedbackHandoff: feedbackHandoffRaw,
    withNew,
    apptId,
  });
  const overflowOverrunSeconds = inPlacePreviewOverflowOverrunSeconds(withNew);

  if (newScore == null) {
    const reason = withNewReason
      ? humanizeInPlaceReason(withNewReason, context)
      : withNew.feasible === false
        ? context === 'time'
          ? 'This time is not feasible for the visit on this route.'
          : 'This type is not feasible at the current scheduled time.'
        : context === 'time'
          ? 'Could not score this visit at the proposed time.'
          : 'Could not score this visit at the current slot with the new type.';
  return {
      originalScore,
      newScore: null,
      delta,
      headerSuffix: null,
      summaryLine: originalScore == null ? reason : null,
      originalScoreLine:
        originalScore != null
          ? `Current edit score: ${formatPreviewScore(originalScore)} (lower is better).`
          : null,
      newTypeUnavailableLine: reason,
      windowLine,
      windowWarningMayChange,
      arrivalWindowAfter,
      withNewTypeFeasible: withNewFeasible,
      withNewTypeReason: withNewReason,
      downstreamWindowEdge,
      overflowOverrunSeconds,
      feedbackHandoff: null,
    };
  }

  const summaryLine = formatInPlacePreviewScoreSummaryLine({
    newScore,
    originalScore,
    delta,
  });

  const infeasibleReason =
    isInfeasible && withNewReason
      ? humanizeInPlaceReason(withNewReason, context)
      : isInfeasible
        ? context === 'time'
          ? 'This time is not feasible for the visit on this route.'
          : 'This type is not feasible at the current scheduled time.'
        : null;

  return {
    originalScore,
    newScore,
    delta,
    headerSuffix: null,
    summaryLine,
    originalScoreLine: null,
    newTypeUnavailableLine: infeasibleReason,
    windowLine,
    windowWarningMayChange,
    arrivalWindowAfter,
    withNewTypeFeasible: withNewFeasible,
    withNewTypeReason: withNewReason,
    downstreamWindowEdge,
    overflowOverrunSeconds,
    feedbackHandoff: isInfeasible ? null : feedbackHandoff,
  };
}

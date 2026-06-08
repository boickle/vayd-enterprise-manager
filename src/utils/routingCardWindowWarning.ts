import type { DayData } from '../pages/MyWeek';
import {
  computeDriveTimeWindowWarning,
  shouldShowEtaWindowWarning,
  WINDOW_WARNING_MINUTES_FROM_END,
} from './windowWarning';
import { schedulerHouseholdIsClientFixedTime } from './schedulerWindowWarning';
import {
  routingCandidateHasDownstreamWindowEdgeWarning,
  type RoutingScoreBreakdownCarrier,
} from './routingScoreBreakdown';

export type RoutingCardWindowWarningSource = RoutingScoreBreakdownCarrier & {
  suggestedStartIso?: string | null;
  arrivalWindow?: {
    windowStartIso?: string | null;
    windowEndIso?: string | null;
  } | null;
};

/** Routing score penalty — downstream visit tight to window end. */
export function routingCandidateDownstreamScoreWarning(
  opt: RoutingCardWindowWarningSource | null | undefined
): boolean {
  return routingCandidateHasDownstreamWindowEdgeWarning(opt);
}

/**
 * Before ETA: suggested placement vs candidate arrival window (same 20-minute rule as drive-time UI).
 */
export function routingCandidateSuggestedStartWindowWarning(
  opt: RoutingCardWindowWarningSource | null | undefined
): boolean {
  const aw = opt?.arrivalWindow;
  const start = opt?.suggestedStartIso?.trim();
  const windowEnd = aw?.windowEndIso?.trim();
  if (!start || !windowEnd) return false;
  return shouldShowEtaWindowWarning(start, windowEnd, aw?.windowStartIso);
}

export type RoutingEtaReconciledWindowSummary = {
  hasAnyWarning: boolean;
  warningStopCount: number;
  candidateHasWarning: boolean;
};

/** After POST /routing/eta — same rules as Scheduler / My Week drive-time badges. */
export function summarizeReconciledDayWindowWarnings(
  dayData: DayData | null | undefined
): RoutingEtaReconciledWindowSummary {
  if (!dayData?.households?.length) {
    return { hasAnyWarning: false, warningStopCount: 0, candidateHasWarning: false };
  }

  let warningStopCount = 0;
  let candidateHasWarning = false;

  dayData.households.forEach((h, idx) => {
    if (h.isPersonalBlock) return;
    const slot = dayData.timeline[idx];
    const etaIso = slot?.eta ?? null;
    const windowEndIso =
      (slot?.windowStartIso != null && slot?.windowEndIso != null ? slot.windowEndIso : null) ??
      (h as { windowEndIso?: string | null }).windowEndIso ??
      h.effectiveWindow?.endIso ??
      null;
    const windowStartIso =
      (slot?.windowStartIso != null && slot?.windowEndIso != null ? slot.windowStartIso : null) ??
      (h as { windowStartIso?: string | null }).windowStartIso ??
      h.effectiveWindow?.startIso ??
      null;

    const warns = computeDriveTimeWindowWarning({
      etaIso,
      windowEndIso,
      windowStartIso,
      isClientFixedTime: schedulerHouseholdIsClientFixedTime(h),
      scheduledStartIso: h.startIso,
    });

    if (warns) {
      warningStopCount += 1;
      if (h.isPreview) candidateHasWarning = true;
    }
  });

  return {
    hasAnyWarning: warningStopCount > 0,
    warningStopCount,
    candidateHasWarning,
  };
}

export type RoutingCardWindowWarningReason =
  | 'downstream-score'
  | 'suggested-start'
  | 'eta-reconciled';

export function routingCardWindowWarningReasons(
  opt: RoutingCardWindowWarningSource | null | undefined,
  etaReconciled?: RoutingEtaReconciledWindowSummary | null
): RoutingCardWindowWarningReason[] {
  const reasons: RoutingCardWindowWarningReason[] = [];
  if (routingCandidateDownstreamScoreWarning(opt)) reasons.push('downstream-score');
  if (routingCandidateSuggestedStartWindowWarning(opt)) reasons.push('suggested-start');
  if (etaReconciled?.hasAnyWarning) reasons.push('eta-reconciled');
  return reasons;
}

export function routingCardWindowWarningMessage(
  reasons: RoutingCardWindowWarningReason[]
): string | null {
  if (reasons.length === 0) return null;
  const n = WINDOW_WARNING_MINUTES_FROM_END;
  if (reasons.includes('eta-reconciled') && reasons.length === 1) {
    return `⚠ Window warning — reconciled drive times show a visit within ${n} minutes of its window end (matches calendar preview).`;
  }
  if (reasons.includes('downstream-score') && reasons.includes('suggested-start')) {
    return `⚠ Window warning — tight arrival window and a downstream visit may be pushed near its window end.`;
  }
  if (reasons.includes('downstream-score')) {
    return `⚠ At least one downstream appointment is pushed within ${n} minutes of its window end.`;
  }
  if (reasons.includes('suggested-start')) {
    return `⚠ Suggested start is within ${n} minutes of this visit's arrival window end.`;
  }
  if (reasons.includes('eta-reconciled')) {
    return `⚠ Window warning — reconciled drive times show a visit within ${n} minutes of its window end (matches calendar preview).`;
  }
  return null;
}

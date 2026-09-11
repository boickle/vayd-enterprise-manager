import type { DayData } from '../pages/MyWeek';
import { resolveArrivalWindowIsos } from './appointmentRoutedArrivalWindow';
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
  /** Any client stop on the day is tight to its window end (includes upstream pre-existing). */
  hasAnyWarning: boolean;
  warningStopCount: number;
  candidateHasWarning: boolean;
  /**
   * Preview candidate itself, or a stop at/after it in route order, is tight to window end.
   * Upstream-only tightness (e.g. Belle already near window end when placing a later slot)
   * must not light the new result card — staff already see that on the calendar visit.
   */
  hasPlacementRelevantWarning: boolean;
};

/**
 * After POST /routing/eta — same window resolution + 20-minute rule as Scheduler
 * drive-time badges (`resolveArrivalWindowIsos`, including type ±N fallback).
 * Household/slot-only lookup used to miss warnings the calendar already showed.
 */
export function summarizeReconciledDayWindowWarnings(
  dayData: DayData | null | undefined
): RoutingEtaReconciledWindowSummary {
  if (!dayData?.households?.length) {
    return {
      hasAnyWarning: false,
      warningStopCount: 0,
      candidateHasWarning: false,
      hasPlacementRelevantWarning: false,
    };
  }

  const households = dayData.households;
  const n = households.length;
  const practiceTz = dayData.timezone || 'America/New_York';
  const order =
    Array.isArray(dayData.routingOrderIndices) && dayData.routingOrderIndices.length === n
      ? dayData.routingOrderIndices
      : Array.from({ length: n }, (_, i) => i);

  let previewOrderPos = -1;
  for (let p = 0; p < order.length; p++) {
    if (households[order[p]]?.isPreview) {
      previewOrderPos = p;
      break;
    }
  }

  let warningStopCount = 0;
  let candidateHasWarning = false;
  let hasPlacementRelevantWarning = false;

  for (let orderPos = 0; orderPos < order.length; orderPos++) {
    const idx = order[orderPos]!;
    const h = households[idx];
    if (!h || h.isPersonalBlock) continue;
    const slot = dayData.timeline[idx];
    const etaIso = slot?.eta ?? null;
    const primary = h.primary as
      | {
          appointmentStart?: string;
          appointmentEnd?: string;
          appointmentType?: {
            name?: string;
            prettyName?: string | null;
            windowBeforeMinutes?: number | null;
            windowAfterMinutes?: number | null;
          };
          effectiveWindow?: { startIso?: string; endIso?: string } | null;
        }
      | undefined;
    const resolved = resolveArrivalWindowIsos({
      apptEffectiveWindow: primary?.effectiveWindow ?? h.effectiveWindow ?? null,
      household: h,
      slot,
      scheduledStartIso: h.startIso ?? primary?.appointmentStart ?? null,
      appointmentType: primary?.appointmentType
        ? {
            name: primary.appointmentType.name ?? '',
            prettyName: primary.appointmentType.prettyName,
            windowBeforeMinutes: primary.appointmentType.windowBeforeMinutes,
            windowAfterMinutes: primary.appointmentType.windowAfterMinutes,
          }
        : undefined,
      appointmentEndIso: h.endIso ?? primary?.appointmentEnd ?? null,
      practiceTz,
    });
    const windowStartIso = resolved?.startIso ?? null;
    const windowEndIso = resolved?.endIso ?? null;

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
      // No preview row → keep prior "any warning" behavior for non-preview callers.
      if (previewOrderPos < 0 || orderPos >= previewOrderPos) {
        hasPlacementRelevantWarning = true;
      }
    }
  }

  return {
    hasAnyWarning: warningStopCount > 0,
    warningStopCount,
    candidateHasWarning,
    hasPlacementRelevantWarning,
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
  // suggested-start is computed for scoring but not shown on routing cards.
  // Only candidate / downstream reconciled tightness — not upstream pre-existing warnings.
  if (etaReconciled?.hasPlacementRelevantWarning) reasons.push('eta-reconciled');
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
  if (reasons.includes('downstream-score')) {
    return `⚠ At least one downstream appointment is pushed within ${n} minutes of its window end.`;
  }
  if (reasons.includes('eta-reconciled')) {
    return `⚠ Window warning — reconciled drive times show a visit within ${n} minutes of its window end (matches calendar preview).`;
  }
  return null;
}

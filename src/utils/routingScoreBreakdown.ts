/**
 * Routing slot-search score breakdown helpers.
 * API may send `scoreBreakdown` (preferred) or legacy `scoringComponents` on each candidate.
 */

export type RoutingScoreBreakdownCarrier = {
  scoreBreakdown?: { downstreamWindowEdge?: number | null } | null;
  scoringComponents?: { downstreamWindowEdge?: number | null } | null;
};

/** > 0 when routing penalized a downstream visit for arriving tight to its window end. */
export function routingCandidateDownstreamWindowEdge(
  candidate: RoutingScoreBreakdownCarrier | null | undefined
): number {
  const raw =
    candidate?.scoreBreakdown?.downstreamWindowEdge ??
    candidate?.scoringComponents?.downstreamWindowEdge;
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : 0;
}

export function routingCandidateHasDownstreamWindowEdgeWarning(
  candidate: RoutingScoreBreakdownCarrier | null | undefined
): boolean {
  return routingCandidateDownstreamWindowEdge(candidate) > 0;
}

/**
 * Helpers for routing slot lists: `top[]` (v2) or winner + alternates (legacy shape).
 * `candidateIndex` is the index in that ordered list (0 = winner / first in top).
 */

export type RoutingCandidateLike = {
  candidateIndex?: number;
  candidateId?: string;
  date?: string;
  insertionIndex?: number;
  suggestedStartIso?: string;
  doctorId?: string;
};

export type RoutingSlotSearchShape = {
  top?: RoutingCandidateLike[];
  winner?: RoutingCandidateLike;
  alternates?: RoutingCandidateLike[];
};

export function routingTopCandidatesFromResult(result: RoutingSlotSearchShape): RoutingCandidateLike[] {
  if (Array.isArray(result.top) && result.top.length > 0) return result.top;
  const rows: RoutingCandidateLike[] = [];
  if (result.winner) rows.push(result.winner);
  if (Array.isArray(result.alternates)) rows.push(...result.alternates);
  return rows;
}

function candidateIdentityKey(c: RoutingCandidateLike): string {
  return [
    c.candidateId ?? '',
    c.doctorId ?? '',
    c.date ?? '',
    String(c.insertionIndex ?? ''),
    c.suggestedStartIso ?? '',
  ].join('|');
}

/** Prefer API `candidateIndex`; otherwise locate the row in the ordered top list. */
export function resolveRoutingCandidateIndex(
  candidate: RoutingCandidateLike,
  top: RoutingCandidateLike[]
): number {
  if (typeof candidate.candidateIndex === 'number' && Number.isFinite(candidate.candidateIndex)) {
    return candidate.candidateIndex;
  }
  const key = candidateIdentityKey(candidate);
  const idx = top.findIndex((t) => candidateIdentityKey(t) === key);
  return idx >= 0 ? idx : 0;
}

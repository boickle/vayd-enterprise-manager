/**
 * Care Coverage Comparison helpers for Room Loader membership simulate.
 *
 * Simulate `lineItemAdjustments` are matched to summary lines by name. Plan-included
 * wellness visit/exam rows often use near-synonyms ("Annual Wellness Visit" vs
 * "Annual Wellness Exam"), or the API omits a $0 adjustment when itemType/itemId
 * were missing — while trip fee / sharps still show as covered. These helpers keep
 * the comparison table and footer totals aligned with Foundations/Golden benefits.
 */

export function normMembershipItemName(n: string | undefined): string {
  return (n ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\u2013\u2014\u2212]/g, '-')
    .replace(/\s+/g, ' ');
}

/**
 * Annual / comprehensive wellness visit or exam included in Foundations/Golden —
 * not medical, tech/quick, or "additional" wellness visits.
 */
export function isPlanIncludedWellnessVisitLineName(name: string | undefined): boolean {
  const n = normMembershipItemName(name);
  if (!n) return false;
  if (/\b(medical|sick|emergency|tech|technician|quick)\b/.test(n)) return false;
  if (/\badditional\b/.test(n)) return false;
  if (!n.includes('wellness')) return false;
  return n.includes('visit') || n.includes('exam') || n.includes('consult');
}

export function membershipCoverageNamesMatch(
  lineName: string | undefined,
  adjustmentName: string | undefined,
  normItemName: (s: string) => string = normMembershipItemName
): boolean {
  if (normItemName(lineName ?? '') === normItemName(adjustmentName ?? '')) return true;
  return (
    isPlanIncludedWellnessVisitLineName(lineName) && isPlanIncludedWellnessVisitLineName(adjustmentName)
  );
}

export type MembershipCoverageAdjustmentLike = {
  name: string;
  patientId: number;
  originalPrice: number;
  adjustedPrice: number;
  quantity?: number;
};

export function findMembershipCoverageAdjustmentIndex(
  line: { name?: string; patientId?: number },
  adjustments: MembershipCoverageAdjustmentLike[] | undefined,
  usedAdj: Set<number>,
  petPatientId: number,
  normItemName: (s: string) => string = normMembershipItemName
): number {
  if (!adjustments?.length) return -1;
  return adjustments.findIndex(
    (a, i) =>
      !usedAdj.has(i) &&
      Number(a.patientId) === Number(petPatientId) &&
      membershipCoverageNamesMatch(line.name, a.name, normItemName)
  );
}

export function adjustmentShowsMembershipCoverage(a: MembershipCoverageAdjustmentLike): boolean {
  const adj = Number(a.adjustedPrice);
  const orig = Number(a.originalPrice);
  if (!Number.isFinite(adj) || !Number.isFinite(orig)) return false;
  return adj < 0.005 || adj < orig - 0.005;
}

export type MembershipSimulateLineItemLike = { name?: string; price: number; quantity?: number };

/**
 * Dollar amount that should count as covered for a Foundations/Golden plan-included
 * wellness visit when simulate left it at full price (no covering adjustment).
 * Add to covered estimate and subtract from member-priced visit due.
 */
export function computeMissingPlanIncludedWellnessVisitCoverageDelta(
  planBase: string,
  petPatientId: number,
  filteredLines: MembershipSimulateLineItemLike[],
  adjustments: MembershipCoverageAdjustmentLike[] | undefined,
  normItemName: (s: string) => string = normMembershipItemName
): number {
  if (planBase !== 'golden' && planBase !== 'foundations') return 0;
  const usedAdj = new Set<number>();
  let delta = 0;
  for (const line of filteredLines) {
    if (!isPlanIncludedWellnessVisitLineName(line.name)) continue;
    const matchIdx = findMembershipCoverageAdjustmentIndex(
      line,
      adjustments,
      usedAdj,
      petPatientId,
      normItemName
    );
    if (matchIdx >= 0) {
      usedAdj.add(matchIdx);
      const a = adjustments![matchIdx];
      if (adjustmentShowsMembershipCoverage(a)) continue;
    }
    const lineTotal = Number(line.price) * (Number(line.quantity) || 1);
    if (Number.isFinite(lineTotal) && lineTotal > 0.005) delta += lineTotal;
  }
  return delta;
}

/**
 * Square / formatted plan names sometimes repeat the same label around an em dash
 * (e.g. "Golden Only - Dog, Monthly — Golden Only - Dog, Monthly").
 */
export function cleanDuplicatedMembershipPlanDisplayName(name: string | undefined): string {
  const raw = (name ?? '').trim();
  if (!raw) return raw;
  const parts = raw
    .split(/\s*[—–]\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 2 && normMembershipItemName(parts[0]) === normMembershipItemName(parts[1])) {
    return parts[0];
  }
  return raw;
}

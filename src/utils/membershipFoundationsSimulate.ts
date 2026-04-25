/**
 * Foundations (non-Golden) membership simulate can mark senior screen lines as fully covered ($0 adjusted)
 * even though they are not plan-included — see `foundationsMayFalseZeroSeniorPanel` in PublicRoomLoaderForm.
 * Used for Care Coverage Comparison rows and to reconcile footer covered / due amounts with that reality.
 */
export function seniorScreenLineNameFalseFoundationsFullCoverage(name: string | undefined): boolean {
  const n = (name ?? '').toLowerCase();
  if (!n.includes('senior screen')) return false;
  if (n.includes('early detection')) return false;
  return true;
}

export type MembershipSimulateLineItemLike = { name?: string; price: number; quantity?: number };

export type LineItemAdjustmentLike = {
  name: string;
  patientId: number;
  originalPrice: number;
  adjustedPrice: number;
  quantity: number;
};

/**
 * Dollar amount wrongly implied as “covered” on the visit (originalVisit − withMembership) when simulate
 * sets `adjustedPrice === 0` for a Foundations non-benefit senior screen line. Subtract from covered estimate
 * and add to member-priced visit due.
 */
export function computeFoundationsSeniorScreenFalseCoverageVisitDelta(
  planBase: string,
  petPatientId: number,
  filteredLines: MembershipSimulateLineItemLike[],
  adjustments: LineItemAdjustmentLike[] | undefined,
  normItemName: (s: string) => string
): number {
  if (planBase !== 'foundations' || !adjustments?.length) return 0;
  let delta = 0;
  for (const line of filteredLines) {
    if (!seniorScreenLineNameFalseFoundationsFullCoverage(line.name)) continue;
    const a = adjustments.find(
      (x) => x.patientId === petPatientId && normItemName(x.name) === normItemName(line.name ?? '')
    );
    if (!a || Number(a.adjustedPrice) !== 0) continue;
    const lineTotal = Number(line.price) * (Number(line.quantity) || 1);
    if (Number.isFinite(lineTotal) && lineTotal > 0.005) delta += lineTotal;
  }
  return delta;
}

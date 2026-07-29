/**
 * Backend check-item-pricing / embedded wellness pricing can mark senior comprehensive panels as
 * $0 with hasCoverage for Foundations (non-Golden) members even though only Golden includes those
 * panels. Early Detection (FIL481/FIL487) and trip/visit/sharps stay truly covered.
 */

/** Senior chem / bundled senior panel codes that Foundations may falsely zero-out. */
export const FOUNDATIONS_FALSE_ZERO_SENIOR_PANEL_CODES = new Set([
  'FIL8659999',
  '8659999',
  'FIL25659999',
  'FIL45129999',
]);

export function normalizeMembershipPlanLabel(label: string | null | undefined): string {
  return (label ?? '').trim().toLowerCase();
}

/** True when plan label is Foundations (or foundation) and not Golden. */
export function membershipLabelIsFoundationsNotGolden(label: string | null | undefined): boolean {
  const s = normalizeMembershipPlanLabel(label);
  if (!s) return false;
  if (s.includes('golden')) return false;
  return s.includes('foundations') || s.includes('foundation');
}

export function isFoundationsFalseZeroSeniorPanelCode(code: string | null | undefined): boolean {
  const c = (code ?? '').trim().toUpperCase();
  return c !== '' && FOUNDATIONS_FALSE_ZERO_SENIOR_PANEL_CODES.has(c);
}

/** Senior Screen line names that are not Early Detection (Foundations false full-coverage candidates). */
export function seniorScreenLineNameFalseFoundationsFullCoverage(name: string | undefined): boolean {
  const n = (name ?? '').toLowerCase();
  if (!n.includes('senior screen')) return false;
  if (n.includes('early detection')) return false;
  return true;
}

export function foundationsSeniorPanelLooksFalselyCovered(opts: {
  code?: string | null;
  name?: string | null;
}): boolean {
  if (isFoundationsFalseZeroSeniorPanelCode(opts.code)) return true;
  return seniorScreenLineNameFalseFoundationsFullCoverage(opts.name ?? undefined);
}

export type FoundationsFalseZeroWellnessLike = {
  hasCoverage?: boolean;
  adjustedPrice?: number | null;
  originalPrice?: number | null;
  priceAdjustedByMembership?: boolean;
  outOfPlanDiscountApplied?: boolean;
  membershipDiscountAmount?: number | null;
  membershipPlanName?: string | null;
};

function wellnessPlanHasDiscountSignal(wp: FoundationsFalseZeroWellnessLike | null | undefined): boolean {
  if (!wp) return false;
  const o = wp.originalPrice != null ? Number(wp.originalPrice) : null;
  const a = wp.adjustedPrice != null ? Number(wp.adjustedPrice) : null;
  if (o != null && a != null && o !== a) return true;
  if (wp.priceAdjustedByMembership === true || wp.outOfPlanDiscountApplied === true) return true;
  if (wp.membershipDiscountAmount != null && Number(wp.membershipDiscountAmount) > 0) return true;
  return false;
}

/**
 * When true, UI should prefer catalog/original price and must not show “Included in Membership”
 * for this senior panel on a Foundations (non-Golden) member.
 */
export function shouldSuppressFalseIncludedWellnessForFoundations(opts: {
  foundationsNotGolden: boolean;
  wellnessPlanPricing?: FoundationsFalseZeroWellnessLike | null;
  /** Top-level check-item-pricing adjusted price (fallback when wp adjusted is missing). */
  adjustedPrice?: number | null;
  /** Top-level original / catalog price fallback. */
  originalPrice?: number | null;
  itemCode?: string | null;
  itemName?: string | null;
}): boolean {
  if (!opts.foundationsNotGolden || !opts.wellnessPlanPricing) return false;
  const wp = opts.wellnessPlanPricing;
  const isSeniorPanel = foundationsSeniorPanelLooksFalselyCovered({
    code: opts.itemCode,
    name: opts.itemName,
  });
  /** Real plan-covered rows (trip, sharps, visit, Early Detection) keep $0 when hasCoverage is true. */
  if (wp.hasCoverage === true && !isSeniorPanel) return false;

  const adjusted =
    wp.adjustedPrice != null && !Number.isNaN(Number(wp.adjustedPrice))
      ? Number(wp.adjustedPrice)
      : opts.adjustedPrice != null && !Number.isNaN(Number(opts.adjustedPrice))
        ? Number(opts.adjustedPrice)
        : null;
  if (!(adjusted != null && adjusted < 0.005)) return false;

  const orig =
    wp.originalPrice != null && !Number.isNaN(Number(wp.originalPrice))
      ? Number(wp.originalPrice)
      : opts.originalPrice != null && !Number.isNaN(Number(opts.originalPrice))
        ? Number(opts.originalPrice)
        : null;
  return Number.isFinite(orig) && (orig as number) > 0.005 && wellnessPlanHasDiscountSignal(wp);
}

/** Catalog/original unit price when suppressing false Foundations senior $0; else null. */
export function foundationsFalseZeroCorrectedUnitPrice(opts: {
  foundationsNotGolden: boolean;
  wellnessPlanPricing?: FoundationsFalseZeroWellnessLike | null;
  adjustedPrice?: number | null;
  originalPrice?: number | null;
  itemCode?: string | null;
  itemName?: string | null;
}): number | null {
  if (!shouldSuppressFalseIncludedWellnessForFoundations(opts)) return null;
  const wp = opts.wellnessPlanPricing;
  const orig =
    wp?.originalPrice != null && !Number.isNaN(Number(wp.originalPrice))
      ? Number(wp.originalPrice)
      : opts.originalPrice != null && !Number.isNaN(Number(opts.originalPrice))
        ? Number(opts.originalPrice)
        : null;
  return orig != null && orig > 0.005 ? orig : null;
}

/**
 * Sanitize wellness pricing embedded on a line so staff/public UI does not claim “included”
 * after correcting a false Foundations senior $0.
 */
export function stripFalseFoundationsSeniorInclusionFromWellness<T extends FoundationsFalseZeroWellnessLike>(
  wp: T | null | undefined,
  correctedUnitPrice: number
): T | null | undefined {
  if (!wp) return wp;
  return {
    ...wp,
    adjustedPrice: correctedUnitPrice,
    hasCoverage: false,
    priceAdjustedByMembership:
      wp.priceAdjustedByMembership === true &&
      wp.originalPrice != null &&
      Number(wp.originalPrice) !== correctedUnitPrice,
  };
}

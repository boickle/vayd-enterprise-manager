import type { MembershipCheckoutDiscount } from '../api/payments';

export type MembershipCostSummary = {
  items: { label: string; monthly?: number | null; annual?: number | null }[];
  totalMonthly: number;
  totalAnnual: number | null;
};

/** Apply Stripe-style percent or fixed discount to a dollar amount (not cents). */
export function applyMembershipDiscountDollars(
  amountDollars: number,
  discount: MembershipCheckoutDiscount,
): number {
  if (discount.percentOff != null && discount.percentOff > 0) {
    return Math.max(0, Math.round(amountDollars * (1 - discount.percentOff / 100) * 100) / 100);
  }
  if (discount.amountOffCents != null && discount.amountOffCents > 0) {
    return Math.max(0, Math.round((amountDollars - discount.amountOffCents / 100) * 100) / 100);
  }
  return amountDollars;
}

export function applyMembershipDiscountToCostSummary(
  summary: MembershipCostSummary,
  discount: MembershipCheckoutDiscount,
): MembershipCostSummary & {
  originalTotalMonthly: number;
  originalTotalAnnual: number | null;
} {
  const originalTotalMonthly = summary.totalMonthly;
  const originalTotalAnnual = summary.totalAnnual;
  const totalMonthly = applyMembershipDiscountDollars(originalTotalMonthly, discount);
  const totalAnnual =
    originalTotalAnnual != null
      ? applyMembershipDiscountDollars(originalTotalAnnual, discount)
      : null;
  const ratio =
    originalTotalMonthly > 0 ? totalMonthly / originalTotalMonthly : 1;

  const items = summary.items.map((row) => ({
    ...row,
    monthly: row.monthly != null ? applyMembershipDiscountDollars(row.monthly, discount) : row.monthly,
    annual:
      row.annual != null
        ? applyMembershipDiscountDollars(row.annual, discount)
        : row.annual,
  }));

  // If only fixed amount off, line-item split by ratio is approximate; totals use explicit discount math above.
  if (discount.amountOffCents != null && discount.percentOff == null && ratio !== 1) {
    return {
      items: summary.items.map((row) => ({
        ...row,
        monthly: row.monthly != null ? Math.round((row.monthly ?? 0) * ratio * 100) / 100 : row.monthly,
        annual:
          row.annual != null ? Math.round((row.annual ?? 0) * ratio * 100) / 100 : row.annual,
      })),
      totalMonthly,
      totalAnnual,
      originalTotalMonthly,
      originalTotalAnnual,
    };
  }

  return {
    items,
    totalMonthly,
    totalAnnual,
    originalTotalMonthly,
    originalTotalAnnual,
  };
}

export const MEMBERSHIP_PROMO_QUERY_PARAM = 'promo';

export function buildMembershipSignupPromoUrl(token: string, pathname = '/client-portal/membership-signup'): string {
  const base = pathname.startsWith('/') ? pathname : `/${pathname}`;
  const sep = base.includes('?') ? '&' : '?';
  return `${window.location.origin}${base}${sep}${MEMBERSHIP_PROMO_QUERY_PARAM}=${encodeURIComponent(token)}`;
}

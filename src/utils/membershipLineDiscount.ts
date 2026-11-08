/**
 * Owner decision Oct 31, 2026: the plan's out-of-plan % shows on the bill as a discount, not a
 * lower price. The line keeps the regular price (`listUnitPrice`) and the server names the
 * discount in `discountReason` ("Membership discount (Puppy/Kitten, 10%)").
 */
export const MEMBERSHIP_DISCOUNT_PREFIX = 'Membership discount (';

export type MembershipLineDiscount = {
  /** "Membership discount (Puppy/Kitten, 10%)". */
  label: string;
  /** The line at the regular price. */
  regularAmount: number;
  /** Positive dollars the membership took off. */
  discount: number;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function isMembershipDiscountReason(reason: string | null | undefined): boolean {
  return String(reason ?? '').startsWith(MEMBERSHIP_DISCOUNT_PREFIX);
}

/** The membership discount on an invoice line, or null when the line has none. */
export function membershipLineDiscount(line: {
  discountReason?: string | null;
  listUnitPrice?: number | null;
  qty?: number | string | null;
  amount?: number | string | null;
  isCovered?: boolean;
}): MembershipLineDiscount | null {
  if (line.isCovered || !isMembershipDiscountReason(line.discountReason)) return null;
  if (line.listUnitPrice == null) return null;
  const qty = Number(line.qty) || 1;
  const regularAmount = round2(Number(line.listUnitPrice) * qty);
  const discount = round2(regularAmount - (Number(line.amount) || 0));
  if (!(discount > 0.009)) return null;
  return { label: String(line.discountReason), regularAmount, discount };
}

/**
 * The regular price total of a line a manager cut by hand (Office exam $75 to $60), to show struck
 * through next to the charged amount, or null for any other line. The server keeps the price before the
 * cut in `listUnitPrice` when the cut is made, as it does for member pricing; a membership discount is
 * shown by its own tag, so it is left to `membershipLineDiscount`.
 */
export function handDiscountRegularAmount(line: {
  discountReason?: string | null;
  listUnitPrice?: number | null;
  manualDiscountAmount?: number | string | null;
  qty?: number | string | null;
  amount?: number | string | null;
  isCovered?: boolean;
}): number | null {
  if (line.isCovered || isMembershipDiscountReason(line.discountReason)) return null;
  if (line.listUnitPrice == null || !((Number(line.manualDiscountAmount) || 0) > 0.009)) return null;
  const regular = round2(Number(line.listUnitPrice) * (Number(line.qty) || 1));
  return regular - (Number(line.amount) || 0) > 0.009 ? regular : null;
}

/**
 * Short tag under a struck-through line ("Member 10%"); the full label goes in its tooltip.
 * Owner, Oct 31, 2026: show it like every other discount: regular price crossed out, the
 * discounted price and total shown.
 */
export function memberDiscountTag(label: string): string {
  const pct = /(\d+(?:\.\d+)?)%\)\s*$/.exec(label)?.[1];
  return pct ? `Member ${pct}%` : 'Member discount';
}

/** Client-facing quote wording: "Member discount 10%". */
export function memberDiscountQuoteLabel(percent: number | null | undefined): string | null {
  const pct = Number(percent);
  if (!Number.isFinite(pct) || pct <= 0) return null;
  return `Member discount ${Math.round(pct * 100) / 100}%`;
}

import { getPreDiscountForOneUnit } from './catalogItemPricing';

/** What a catalog row costs the client, and the money behind it (cost is never shown here). */
export type CatalogMoney = {
  price: number | null;
  cost: number | null;
  serviceFee: number | null;
  minimumPrice: number | null;
};

export type BranchOverrideMoney = Partial<CatalogMoney> & { markup?: number | string | null };

const num = (v: unknown): number | null =>
  v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v);

/**
 * A branch's money for an item: the API's `applyBranchOverride` (branch-catalog.service), so the
 * price list matches what checkout charges at that branch. A markup makes the price follow cost.
 */
export function applyBranchOverride(
  base: CatalogMoney,
  o?: BranchOverrideMoney | null
): CatalogMoney {
  if (!o) return { ...base };
  const cost = num(o.cost) ?? base.cost;
  const markup = num(o.markup);
  const price =
    markup != null && cost != null && cost > 0
      ? Math.round(cost * markup) / 100
      : (num(o.price) ?? base.price);
  return {
    price,
    cost,
    serviceFee: num(o.serviceFee) ?? base.serviceFee,
    minimumPrice: num(o.minimumPrice) ?? base.minimumPrice,
  };
}

/** One unit's client price (fee added, minimum applied), the way checkout prices it. */
export function clientUnitPrice(itemType: string, money: CatalogMoney): number {
  return getPreDiscountForOneUnit({
    itemType,
    price: money.price ?? 0,
    serviceFee: money.serviceFee ?? 0,
    minimumPrice: money.minimumPrice ?? 0,
  } as Parameters<typeof getPreDiscountForOneUnit>[0]);
}

/**
 * The price a price-list row shows. A product shows its price per unit; its dispensing fee and
 * minimum are per charge, so they go in `priceListChargeNote`. Folding them in made Carprofen
 * ($1.29 a caplet, $15 fee, $31.90 minimum) read "$31.90 · tablet" (Q3, owner, Nov 9, 2026).
 * Procedures and labs are charged once, so they keep the one-unit charge.
 */
export function priceListUnitPrice(itemType: string, money: CatalogMoney): number {
  if (itemType === 'inventory') return money.price ?? 0;
  return clientUnitPrice(itemType, money);
}

const usd = (n: number) => `$${n.toFixed(2)}`;

/** "+ $15.00 fee per charge · $31.90 minimum charge" for a product with a fee or minimum. */
export function priceListChargeNote(itemType: string, money: CatalogMoney): string | null {
  if (itemType !== 'inventory') return null;
  const parts: string[] = [];
  const fee = money.serviceFee ?? 0;
  const minimum = money.minimumPrice ?? 0;
  if (fee > 0) parts.push(`+ ${usd(fee)} fee per charge`);
  if (minimum > 0) parts.push(`${usd(minimum)} minimum charge`);
  return parts.length ? parts.join(' · ') : null;
}

export type PriceVariant = { label: string; price: number };

/**
 * Prices that differ from the practice price: each branch with its own price, and the online
 * store (inventory only). Same price everywhere → empty (owner request, Oct 30, 2026).
 */
export function priceVariants(args: {
  itemType: string;
  base: CatalogMoney;
  onlineStorePrice?: number | string | null;
  branchOverrides: Array<{ branchName: string; override: BranchOverrideMoney }>;
}): PriceVariant[] {
  const practice = Math.round(priceListUnitPrice(args.itemType, args.base) * 100) / 100;
  const out: PriceVariant[] = [];
  for (const b of args.branchOverrides) {
    const price =
      Math.round(
        priceListUnitPrice(args.itemType, applyBranchOverride(args.base, b.override)) * 100
      ) / 100;
    if (Math.abs(price - practice) >= 0.005) out.push({ label: b.branchName, price });
  }
  const online = num(args.onlineStorePrice);
  if (online != null && online > 0 && Math.abs(online - practice) >= 0.005) {
    out.push({ label: 'Online store', price: Math.round(online * 100) / 100 });
  }
  return out;
}

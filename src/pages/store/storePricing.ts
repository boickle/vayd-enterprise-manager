export type StorePriceBreak = {
  lowQuantity: number;
  highQuantity: number;
  price: number;
};

export type StoreSaleType = 'amount' | 'percent';

export type StoreSale = {
  saleType?: StoreSaleType | null;
  saleValue?: number | null;
  saleEndsAt?: string | null;
  saleLabel?: string | null;
  saleActive?: boolean;
};

export function todayDateOnly(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function isStoreSaleActive(sale: StoreSale | null | undefined): boolean {
  if (sale?.saleActive != null) return Boolean(sale.saleActive);
  const type = sale?.saleType;
  const value = Number(sale?.saleValue);
  if ((type !== 'amount' && type !== 'percent') || !Number.isFinite(value) || value <= 0) {
    return false;
  }
  return !sale?.saleEndsAt || sale.saleEndsAt >= todayDateOnly();
}

export function applyStoreSale(
  unitPrice: number,
  sale: StoreSale | null | undefined,
): number {
  const price = Number(unitPrice) || 0;
  if (!isStoreSaleActive(sale) || sale?.saleValue == null || !sale.saleType) return price;
  if (sale.saleType === 'amount') {
    return Math.max(0, Math.round((price - Number(sale.saleValue)) * 100) / 100);
  }
  return Math.max(0, Math.round(price * (1 - Number(sale.saleValue) / 100) * 100) / 100);
}

export function formatSaleEnds(saleEndsAt: string | null | undefined): string {
  if (!saleEndsAt) return '';
  const [y, m, d] = saleEndsAt.split('-').map(Number);
  if (!y || !m || !d) return '';
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

export function storeUnitPrice(
  base: number | null | undefined,
  breaks: StorePriceBreak[] | undefined,
  qty: number,
): number {
  const n = Math.max(1, Math.floor(Number(qty) || 1));
  const fallback = Number(base ?? 0);
  const active = breaks || [];
  const hit = active.find(
    (row) => n >= Number(row.lowQuantity) && n <= Number(row.highQuantity),
  );
  if (hit) return Number(hit.price);
  if (active.length) {
    const minLow = Math.min(...active.map((row) => Number(row.lowQuantity)));
    if (n < minLow) return fallback;
    const highest = active.reduce((max, row) =>
      Number(row.highQuantity) > Number(max.highQuantity) ? row : max,
    );
    return Number(highest.price);
  }
  return fallback;
}

/**
 * Unit price for a cart line of `qty`, matching checkout: the quantity break and sale set the
 * per-unit price, then the service fee (once per line) and the minimum apply to the line.
 * Spread over the qty so qty × unit = line total.
 */
export function storeLineUnitPrice(args: {
  itemType?: 'inventory' | 'procedure';
  base: number | null | undefined;
  breaks?: StorePriceBreak[];
  sale?: StoreSale | null;
  serviceFee?: number | null;
  minimumPrice?: number | null;
  qty: number;
}): number {
  const qty = Math.max(1, Math.floor(Number(args.qty) || 1));
  const unit = applyStoreSale(storeUnitPrice(args.base, args.breaks, qty), args.sale);
  const withFee = unit * qty + (Number(args.serviceFee) || 0);
  const min = args.itemType === 'procedure' ? 0 : Number(args.minimumPrice) || 0;
  return (min > 0 ? Math.max(min, withFee) : withFee) / qty;
}

export function storeTaxRateForLevel(
  taxLevelValue: number | null | undefined,
  rates: { level1: number; level2: number; level3: number }
): number {
  const level = Number(taxLevelValue);
  if (!Number.isFinite(level) || level === 0) return 0;
  const pct = level === 2 ? rates.level2 : level === 3 ? rates.level3 : rates.level1;
  return (Number(pct) || 0) / 100;
}

export function roundStoreMoney(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** What a buyer pays for a gift card of this face value. Matches checkout: never free. */
export function storeGiftCardPrice(face: number, sale: StoreSale | null | undefined): number {
  const value = roundStoreMoney(face);
  const price = applyStoreSale(value, sale);
  return price > 0 ? price : value;
}

/** Why an amount can't be bought from this listing, or null when it can. */
export function storeGiftCardAmountError(
  amount: number,
  rules: { amounts: number[]; allowCustom: boolean; min: number | null; max: number | null },
): string | null {
  const face = roundStoreMoney(amount);
  if (!(face > 0)) return 'Choose an amount.';
  if (rules.amounts.includes(face)) return null;
  if (!rules.allowCustom) return 'Choose one of the amounts above.';
  const min = rules.min ?? 1;
  if (face < min) return `Gift cards start at $${min.toFixed(2)}.`;
  if (rules.max != null && face > rules.max) return `Gift cards can be up to $${rules.max.toFixed(2)}.`;
  return null;
}

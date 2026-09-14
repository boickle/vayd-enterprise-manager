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

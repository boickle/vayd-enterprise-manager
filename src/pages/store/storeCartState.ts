import { applyStoreSale, storeUnitPrice, type StorePriceBreak, type StoreSale } from './storePricing';

export const AUTOSHIP_FREQS = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'every_6_months', label: 'Every 6 months' },
  { value: 'yearly', label: 'Yearly' },
] as const;

export function formatAutoshipFrequency(frequency: string | null | undefined): string {
  if (!frequency) return '';
  if (frequency === 'monthly') return 'Monthly';
  if (frequency === 'quarterly') return 'Quarterly';
  if (frequency === 'every_2_months') return 'Every 2 months';
  if (frequency === 'every_6_months') return 'Every 6 months';
  if (frequency === 'yearly') return 'Yearly';
  if (frequency === 'weekly') return 'Weekly';
  const custom = /^every_(\d+)_(days|weeks|months)$/i.exec(frequency);
  if (custom) {
    const n = Number(custom[1]);
    const unit = custom[2].toLowerCase();
    const singular = unit.replace(/s$/, '');
    return `Every ${n} ${n === 1 ? singular : unit}`;
  }
  return frequency.replace(/_/g, ' ');
}

export type StoreCartLine = {
  inventoryItemId: number;
  name: string;
  quantity: number;
  unitPrice: number;
  basePrice?: number;
  priceBreaks?: StorePriceBreak[];
  sale?: StoreSale | null;
  autoshipFrequency: string | null;
  recommendedFrequency: string | null;
  listingId?: string | null;
  storeProductId?: number | null;
  hasImage?: boolean;
  approvalTag?: 'approved' | 'needs_doctor_approval';
  patientIds?: number[];
  taxLevelValue?: number | null;
};

const KEY = 'vayd_store_cart';
export const STORE_CART_EVENT = 'vayd-store-cart';

export function readStoreCart(): StoreCartLine[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeStoreCart(lines: StoreCartLine[]) {
  localStorage.setItem(KEY, JSON.stringify(lines));
  window.dispatchEvent(new Event(STORE_CART_EVENT));
}

export function storeCartCount(lines: StoreCartLine[] = readStoreCart()): number {
  return lines.reduce((n, l) => n + (Number(l.quantity) || 0), 0);
}

export function storeCartSubtotal(lines: StoreCartLine[] = readStoreCart()): number {
  return lines.reduce((n, l) => n + l.unitPrice * l.quantity, 0);
}

export function addToStoreCart(line: StoreCartLine) {
  const lines = readStoreCart();
  const idx = lines.findIndex(
    (l) =>
      l.inventoryItemId === line.inventoryItemId &&
      l.autoshipFrequency === line.autoshipFrequency
  );
  if (idx >= 0) {
    const current = lines[idx]!;
    const nextQty = current.quantity + line.quantity;
    const breaks = line.priceBreaks ?? current.priceBreaks;
    const base = line.basePrice ?? current.basePrice ?? line.unitPrice;
    const sale = line.sale ?? current.sale;
    lines[idx] = {
      ...current,
      quantity: nextQty,
      priceBreaks: breaks,
      basePrice: base,
      sale,
      unitPrice: applyStoreSale(storeUnitPrice(base, breaks, nextQty), sale),
      listingId: line.listingId ?? current.listingId,
      storeProductId: line.storeProductId ?? current.storeProductId,
      hasImage: line.hasImage ?? current.hasImage,
      approvalTag: line.approvalTag ?? current.approvalTag,
    };
  } else {
    lines.push(line);
  }
  writeStoreCart(lines);
  return lines;
}

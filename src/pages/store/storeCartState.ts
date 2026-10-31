import { storeLineUnitPrice, type StorePriceBreak, type StoreSale } from './storePricing';

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
  if (frequency === 'every_2_weeks') return 'Every 2 weeks';
  const custom = /^every_(\d+)_(days|weeks|months)$/i.exec(frequency);
  if (custom) {
    const n = Number(custom[1]);
    const unit = custom[2].toLowerCase();
    const singular = unit.replace(/s$/, '');
    return `Every ${n} ${n === 1 ? singular : unit}`;
  }
  return frequency.replace(/_/g, ' ');
}

/** Natural cadence for checkout copy, e.g. "every month". */
export function autoshipCadencePhrase(frequency: string | null | undefined): string {
  if (!frequency) return '';
  if (frequency === 'monthly') return 'every month';
  if (frequency === 'quarterly') return 'every 3 months';
  if (frequency === 'every_2_months') return 'every 2 months';
  if (frequency === 'every_6_months') return 'every 6 months';
  if (frequency === 'yearly') return 'every year';
  if (frequency === 'weekly') return 'every week';
  if (frequency === 'every_2_weeks') return 'every 2 weeks';
  const label = formatAutoshipFrequency(frequency).toLowerCase();
  if (label.startsWith('every ')) return label;
  return label;
}

/** Advance a date by an autoship frequency (matches API renewal math). */
export function addAutoshipFrequency(from: Date, frequency: string): Date {
  const d = new Date(from);
  const custom = /^every_(\d+)_(day|days|week|weeks|month|months)$/i.exec(frequency || '');
  if (custom) {
    const n = Math.max(1, Number(custom[1]) || 1);
    const unit = custom[2].toLowerCase();
    if (unit.startsWith('day')) d.setDate(d.getDate() + n);
    else if (unit.startsWith('week')) d.setDate(d.getDate() + n * 7);
    else d.setMonth(d.getMonth() + n);
    return d;
  }
  if (frequency === 'monthly') d.setMonth(d.getMonth() + 1);
  else if (frequency === 'quarterly') d.setMonth(d.getMonth() + 3);
  else if (frequency === 'every_2_months') d.setMonth(d.getMonth() + 2);
  else if (frequency === 'every_6_months') d.setMonth(d.getMonth() + 6);
  else if (frequency === 'yearly') d.setFullYear(d.getFullYear() + 1);
  else if (frequency === 'weekly') d.setDate(d.getDate() + 7);
  else if (frequency === 'every_2_weeks') d.setDate(d.getDate() + 14);
  else d.setMonth(d.getMonth() + 1);
  return d;
}

export function isoDateOnly(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Next ship/charge date from today for a frequency change. */
export function nextAutoshipRenewalDate(frequency: string, from: Date = new Date()): string {
  return isoDateOnly(addAutoshipFrequency(from, frequency));
}

export type StoreCartLine = {
  inventoryItemId: number;
  name: string;
  quantity: number;
  unitPrice: number;
  basePrice?: number;
  priceBreaks?: StorePriceBreak[];
  serviceFee?: number | null;
  minimumPrice?: number | null;
  sale?: StoreSale | null;
  autoshipFrequency: string | null;
  recommendedFrequency: string | null;
  reminderCadence?: {
    dueAt: number;
    periodUnit: string;
    adjustByQuantity: boolean;
  } | null;
  listingId?: string | null;
  storeProductId?: number | null;
  hasImage?: boolean;
  approvalTag?: 'approved' | 'needs_doctor_approval';
  /** The listing must be attached to a pet even though it is not a prescription. */
  requiresPet?: boolean;
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

/* ---------- "came from the client portal" context ----------
 * Remembered per tab so the store can offer a "Back to portal" link while the
 * client shops, and so the cart can highlight the item they just reordered. */
const PORTAL_RETURN_KEY = 'vayd_store_from_portal';
const PORTAL_RETURN_TTL_MS = 6 * 60 * 60 * 1000;
export const STORE_PORTAL_RETURN_EVENT = 'vayd-store-portal-return';

export type StorePortalReturn = {
  petId?: string | null;
  petName?: string | null;
  at: number;
};

export function rememberStorePortalReturn(ctx: Omit<StorePortalReturn, 'at'> = {}) {
  try {
    sessionStorage.setItem(PORTAL_RETURN_KEY, JSON.stringify({ ...ctx, at: Date.now() }));
    window.dispatchEvent(new Event(STORE_PORTAL_RETURN_EVENT));
  } catch {
    /* ignore */
  }
}

export function readStorePortalReturn(): StorePortalReturn | null {
  try {
    const raw = sessionStorage.getItem(PORTAL_RETURN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StorePortalReturn;
    if (!parsed || typeof parsed.at !== 'number' || Date.now() - parsed.at > PORTAL_RETURN_TTL_MS) {
      sessionStorage.removeItem(PORTAL_RETURN_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearStorePortalReturn() {
  try {
    sessionStorage.removeItem(PORTAL_RETURN_KEY);
    window.dispatchEvent(new Event(STORE_PORTAL_RETURN_EVENT));
  } catch {
    /* ignore */
  }
}

/** Portal URL to return to (re-selects the pet they were viewing). */
export function storePortalReturnPath(ctx: StorePortalReturn | null): string {
  if (ctx?.petId) return `/client-portal?pet=${encodeURIComponent(String(ctx.petId))}`;
  return '/client-portal';
}

/* ---------- gift cards ----------
 * Kept apart from merchandise lines: a gift card has no inventory item, pet, tax, or
 * shipping, and each one carries its own recipient. */
const GIFT_KEY = 'vayd_store_gift_cart';

export type StoreGiftCardLine = {
  key: string;
  listingId: string;
  name: string;
  /** Face value the recipient can spend. */
  amount: number;
  /** What the buyer pays per card (after any sale). */
  price: number;
  quantity: number;
  sendToSelf: boolean;
  recipientName: string;
  recipientEmail: string;
  /** How the card is signed; checkout uses the buyer's name when blank. */
  fromName?: string;
  message: string;
  /** YYYY-MM-DD, or empty for "send now". */
  deliverAt: string;
};

export function readStoreGiftCart(): StoreGiftCardLine[] {
  try {
    const raw = localStorage.getItem(GIFT_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeStoreGiftCart(lines: StoreGiftCardLine[]) {
  localStorage.setItem(GIFT_KEY, JSON.stringify(lines));
  window.dispatchEvent(new Event(STORE_CART_EVENT));
}

export function addGiftCardToCart(line: Omit<StoreGiftCardLine, 'key'>) {
  const lines = readStoreGiftCart();
  lines.push({ ...line, key: `gc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` });
  writeStoreGiftCart(lines);
  return lines;
}

export function removeGiftCardFromCart(key: string) {
  writeStoreGiftCart(readStoreGiftCart().filter((l) => l.key !== key));
}

export function storeGiftCartTotal(lines: StoreGiftCardLine[] = readStoreGiftCart()): number {
  return Math.round(lines.reduce((n, l) => n + l.price * l.quantity, 0) * 100) / 100;
}

export function storeCartCount(lines: StoreCartLine[] = readStoreCart()): number {
  const gifts = readStoreGiftCart().reduce((n, l) => n + (Number(l.quantity) || 0), 0);
  return lines.reduce((n, l) => n + (Number(l.quantity) || 0), 0) + gifts;
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
    const serviceFee = line.serviceFee ?? current.serviceFee;
    const minimumPrice = line.minimumPrice ?? current.minimumPrice;
    lines[idx] = {
      ...current,
      quantity: nextQty,
      priceBreaks: breaks,
      basePrice: base,
      serviceFee,
      minimumPrice,
      sale,
      unitPrice: storeLineUnitPrice({ base, breaks, sale, serviceFee, minimumPrice, qty: nextQty }),
      listingId: line.listingId ?? current.listingId,
      storeProductId: line.storeProductId ?? current.storeProductId,
      hasImage: line.hasImage ?? current.hasImage,
      approvalTag: line.approvalTag ?? current.approvalTag,
      requiresPet: line.requiresPet ?? current.requiresPet,
      reminderCadence: line.reminderCadence ?? current.reminderCadence,
      recommendedFrequency: line.recommendedFrequency ?? current.recommendedFrequency,
    };
  } else {
    lines.push(line);
  }
  writeStoreCart(lines);
  return lines;
}

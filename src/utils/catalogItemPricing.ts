import {
  checkItemPricing,
  type CheckItemPricingResponse,
  type PricingVisitContext,
  type SearchableItem,
} from '../api/roomLoader';
import {
  createOrder,
  type EncounterOrder,
  type EncounterOrderCatalogType,
  type EncounterOrderKind,
} from '../api/visitWorkflow';
import {
  checkItemPricingWithCoverageChoice,
  type CoverageChoicePrompt,
} from './membershipCoverageChoice';

/** Item shape used for tier + discount pricing (matches Room Loader). */
export type CatalogPricingItem = {
  itemType: string;
  price?: number | null;
  originalPrice?: number | null;
  wellnessPlanPricing?: SearchableItem['wellnessPlanPricing'];
  discountPricing?: SearchableItem['discountPricing'];
  tieredPricing?: SearchableItem['tieredPricing'];
  lab?: Record<string, unknown> | null;
  procedure?: Record<string, unknown> | null;
  inventoryItem?: Record<string, unknown> | null;
  serviceFee?: number;
  minimumPrice?: number;
  /** Fixed price per unit (copay, staff / cost-plus): line = min(line total, qty × this). */
  perUnitPrice?: number | null;
};

export type CatalogLinePrice = {
  unitFinal: number;
  totalFinal: number;
  isCovered: boolean;
};

/** Pre-discount price for 1 unit (Lab / Procedure / Inventory formulas). */
export function getPreDiscountForOneUnit(item: CatalogPricingItem): number {
  const t = String(item.itemType ?? '').toLowerCase();
  if (t === 'lab') {
    return Number(item.lab?.price ?? item.price ?? 0);
  }
  if (t === 'procedure') {
    const p = Number(item.procedure?.price ?? item.price ?? 0);
    const sf = Number(item.procedure?.serviceFee ?? item.serviceFee ?? 0);
    return p + sf;
  }
  if (t === 'inventory') {
    const p = Number(item.inventoryItem?.price ?? item.price ?? 0);
    const sf = Number(item.inventoryItem?.serviceFee ?? item.serviceFee ?? 0);
    const calculated = p + sf;
    const minP =
      item.inventoryItem?.minimumPrice != null
        ? Number(item.inventoryItem.minimumPrice)
        : item.minimumPrice != null
          ? Number(item.minimumPrice)
          : 0;
    if (minP > 0) return Math.max(minP, calculated);
    return calculated;
  }
  return Number(item.price ?? 0);
}

/** Tier unit price for a quantity (quantity price breaks). */
export function getTieredUnitPrice(
  tieredPricing: CatalogPricingItem['tieredPricing'],
  quantity: number,
  baseUnitPrice: number
): number {
  if (
    !tieredPricing?.hasTieredPricing ||
    !tieredPricing.priceBreaks ||
    tieredPricing.priceBreaks.length === 0
  ) {
    return baseUnitPrice;
  }

  const qty = Math.floor(quantity);
  for (const priceBreak of tieredPricing.priceBreaks) {
    if (!priceBreak.isActive) continue;
    const lowQty = parseInt(String(priceBreak.lowQuantity), 10);
    const highQty = parseInt(String(priceBreak.highQuantity), 10);
    if (qty >= lowQty && qty <= highQty) {
      return Number(priceBreak.price);
    }
  }

  const activeBreaks = tieredPricing.priceBreaks.filter((pb) => pb.isActive);
  if (activeBreaks.length > 0) {
    const minLow = Math.min(...activeBreaks.map((pb) => parseInt(String(pb.lowQuantity), 10)));
    if (qty < minLow) return baseUnitPrice;
    const highestTier = activeBreaks.reduce((max, pb) => {
      const maxHighQ = parseInt(String(max.highQuantity), 10);
      const pbHigh = parseInt(String(pb.highQuantity), 10);
      return pbHigh > maxHighQ ? pb : max;
    });
    return Number(highestTier.price);
  }

  return baseUnitPrice;
}

/**
 * Total pre-discount for quantity, the way eVet prices a line: qty × price (or the
 * quantity price break) + the service fee once, and never below the minimum price.
 */
export function getTotalPreDiscountForQuantity(item: CatalogPricingItem, quantity: number): number {
  const q = Math.max(0, Number(quantity) || 0);
  const unit = (base: number) =>
    item.tieredPricing?.hasTieredPricing ? getTieredUnitPrice(item.tieredPricing, q, base) : base;

  const t = String(item.itemType ?? '').toLowerCase();
  if (t === 'lab') {
    const p = unit(Number(item.lab?.price ?? item.price ?? 0));
    return p * q;
  }
  if (t === 'procedure') {
    const p = unit(Number(item.procedure?.price ?? item.price ?? 0));
    const sf = Number(item.procedure?.serviceFee ?? item.serviceFee ?? 0);
    return p * q + sf;
  }
  if (t === 'inventory') {
    const p = unit(Number(item.inventoryItem?.price ?? item.price ?? 0));
    const sf = Number(item.inventoryItem?.serviceFee ?? item.serviceFee ?? 0);
    const minP =
      item.inventoryItem?.minimumPrice != null
        ? Number(item.inventoryItem.minimumPrice)
        : item.minimumPrice != null
          ? Number(item.minimumPrice)
          : 0;
    const calculated = p * q + sf;
    if (minP > 0) return Math.max(minP, calculated);
    return calculated;
  }
  return unit(Number(item.price ?? 0)) * q;
}

/**
 * Percent discounts (client, membership % off) take the same share off the whole line,
 * service fee included. A fixed per-unit price (copay, staff / cost-plus) is charged per
 * unit instead, never above the normal line total.
 */
function discountedLineTotal(
  lineTotal: number,
  qty: number,
  ratio: number,
  perUnitPrice?: number | null
): number {
  if (perUnitPrice != null && Number.isFinite(Number(perUnitPrice))) {
    return Math.min(lineTotal, Math.max(0, Number(perUnitPrice)) * qty);
  }
  return lineTotal * ratio;
}

/** Final unit/total after membership + client discount ratio (Room Loader parity). */
export function getCatalogLinePrice(item: CatalogPricingItem, quantity: number): CatalogLinePrice {
  const preDiscount1 = getPreDiscountForOneUnit(item);
  const totalPreDiscount = getTotalPreDiscountForQuantity(item, quantity);
  const q = Math.max(1, Number(quantity) || 1);

  const adjustedFromApi = Number(item.price ?? 0);
  const originalFromApi = Number(
    item.originalPrice ?? item.wellnessPlanPricing?.originalPrice ?? preDiscount1
  );
  const discountRatio = originalFromApi > 0 ? adjustedFromApi / originalFromApi : 1;

  const totalFinal = discountedLineTotal(totalPreDiscount, q, discountRatio, item.perUnitPrice);
  const unitFinal = q > 0 ? totalFinal / q : adjustedFromApi;

  const isCovered = Boolean(
    item.wellnessPlanPricing?.hasCoverage &&
    item.wellnessPlanPricing?.isWithinLimit &&
    unitFinal === 0
  );

  return { unitFinal, totalFinal, isCovered };
}

/**
 * A bundle line priced at its normal catalog price: `listUnitPrice` already holds the
 * line formula for its qty (fee once, minimum), and membership / client discounts come
 * from check-item as the adjusted ÷ original ratio.
 */
export function getBundleLinePrice(
  line: { listUnitPrice: number; quantity: number; priceOverride?: number | null },
  checked?: Pick<
    CheckItemPricingResponse,
    'adjustedPrice' | 'originalPrice' | 'wellnessPlanPricing' | 'perUnitPrice'
  > | null,
  /** The bundle's percent off every item; the client gets whichever price is lower. */
  bundleDiscountPercent?: number | null
): CatalogLinePrice {
  const q = Math.max(1, Number(line.quantity) || 1);
  const coveredByPlan = Boolean(
    checked?.wellnessPlanPricing?.hasCoverage &&
      checked.wellnessPlanPricing.isWithinLimit &&
      Number(checked.adjustedPrice) === 0
  );
  // The bundle's own price for this item wins over catalog and discounts; only a membership
  // benefit that covers it does better (owner request, Oct 30, 2026).
  if (line.priceOverride != null && Number.isFinite(Number(line.priceOverride))) {
    if (coveredByPlan) return { unitFinal: 0, totalFinal: 0, isCovered: true };
    const unitFinal = Math.max(0, Number(line.priceOverride));
    return { unitFinal, totalFinal: Math.round(unitFinal * q * 100) / 100, isCovered: false };
  }
  const original = Number(checked?.originalPrice ?? 0);
  const adjusted = Number(checked?.adjustedPrice ?? original);
  const ratio = original > 0 ? adjusted / original : 1;
  const listTotal = Number(line.listUnitPrice || 0) * q;
  let totalFinal = discountedLineTotal(listTotal, q, ratio, checked?.perUnitPrice);
  const pct = Number(bundleDiscountPercent);
  if (Number.isFinite(pct) && pct > 0) {
    const bundleTotal = Math.round(listTotal * (1 - Math.min(pct, 100) / 100) * 100) / 100;
    totalFinal = Math.min(totalFinal, bundleTotal);
  }
  const unitFinal = totalFinal / q;
  const isCovered = Boolean(
    checked?.wellnessPlanPricing?.hasCoverage &&
    checked.wellnessPlanPricing.isWithinLimit &&
    unitFinal === 0
  );
  return { unitFinal, totalFinal, isCovered };
}

/** Shared id for every line expanded from one bundle add. */
export function newBundleSaleId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** An item inside a fixed-price pack: the pack line carries the price, so it stays at $0. */
export function isFixedPackItem(order: {
  bundleSaleId?: string | null;
  unitPrice: number | string;
  isCovered?: boolean;
}): boolean {
  return Boolean(order.bundleSaleId) && Number(order.unitPrice) === 0 && !order.isCovered;
}

export function buildCheckItemPayload(
  itemType: string,
  catalogItemId: number
): Record<string, unknown> {
  const t = itemType.toLowerCase();
  if (t === 'lab') return { lab: { id: catalogItemId } };
  if (t === 'procedure') return { procedure: { id: catalogItemId } };
  return { inventoryItem: { id: catalogItemId } };
}

export function buildCheckItemPayloadFromSearch(item: SearchableItem): Record<string, unknown> {
  if (item.itemType === 'lab' && item.lab) return { lab: item.lab };
  if (item.itemType === 'procedure' && item.procedure) return { procedure: item.procedure };
  if (item.itemType === 'inventory' && item.inventoryItem) {
    return { inventoryItem: item.inventoryItem };
  }
  const id = catalogIdFromSearchItem(item);
  if (id != null) return buildCheckItemPayload(item.itemType, id);
  return {};
}

function catalogIdFromSearchItem(item: SearchableItem): number | undefined {
  const raw =
    item.itemType === 'lab'
      ? item.lab?.id
      : item.itemType === 'procedure'
        ? item.procedure?.id
        : item.inventoryItem?.id;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/** Same catalog-id lookup as above, exported for callers building an order directly from search
 * results (e.g. `PlanOrdersSection`, `ScribeSuggestedPlanItems`). */
export const catalogIdForSearchItem = catalogIdFromSearchItem;

/** Maps a catalog search result to the order "kind" used for labels/discharge instructions —
 * shared by every place that turns a search pick into a real order. */
export function kindForCatalogSearchItem(item: SearchableItem): EncounterOrderKind {
  if (item.itemType === 'lab') return 'diagnostic';
  if (item.itemType === 'procedure') return 'treatment';
  if (item.itemType === 'inventory') {
    return item.inventoryItem?.isMedication ? 'med' : 'treatment';
  }
  return 'treatment';
}

export function pricingItemFromSearchAndCheck(
  searchItem: SearchableItem,
  pricing: CheckItemPricingResponse
): CatalogPricingItem {
  return {
    itemType: searchItem.itemType,
    price: pricing.adjustedPrice ?? searchItem.price,
    originalPrice: pricing.originalPrice ?? searchItem.originalPrice ?? searchItem.price,
    perUnitPrice: pricing.perUnitPrice ?? null,
    wellnessPlanPricing: pricing.wellnessPlanPricing ?? searchItem.wellnessPlanPricing,
    discountPricing: pricing.discountPricing ?? searchItem.discountPricing,
    tieredPricing: pricing.tieredPricing ?? searchItem.tieredPricing,
    lab: searchItem.lab ?? pricing.item.lab,
    procedure: searchItem.procedure ?? pricing.item.procedure,
    inventoryItem: searchItem.inventoryItem ?? pricing.item.inventoryItem,
  };
}

export function pricingItemFromCheckResponse(
  pricing: CheckItemPricingResponse
): CatalogPricingItem {
  return {
    itemType: pricing.item.itemType,
    price: pricing.adjustedPrice,
    originalPrice: pricing.originalPrice,
    perUnitPrice: pricing.perUnitPrice ?? null,
    wellnessPlanPricing: pricing.wellnessPlanPricing,
    discountPricing: pricing.discountPricing,
    tieredPricing: pricing.tieredPricing,
    lab: pricing.item.lab,
    procedure: pricing.item.procedure,
    inventoryItem: pricing.item.inventoryItem,
  };
}

export async function fetchCatalogPricingItem(args: {
  patientId: number;
  practiceId: number;
  clientId?: number;
  itemType: string;
  item: Record<string, unknown>;
  visit?: PricingVisitContext;
}): Promise<CatalogPricingItem> {
  const response = await checkItemPricing({
    patientId: args.patientId,
    practiceId: args.practiceId,
    clientId: args.clientId,
    itemType: args.itemType,
    item: args.item,
    ...args.visit,
  });
  return pricingItemFromCheckResponse(response);
}

export async function fetchCatalogPricingForOrder(args: {
  order: EncounterOrder;
  patientId: number;
  practiceId: number;
  clientId?: number;
}): Promise<CatalogPricingItem | null> {
  const { order, patientId, practiceId, clientId } = args;
  if (
    order.catalogItemId == null ||
    !order.catalogItemType ||
    order.catalogItemType === ('custom' as EncounterOrderCatalogType)
  ) {
    return null;
  }
  return fetchCatalogPricingItem({
    patientId,
    practiceId,
    clientId,
    itemType: order.catalogItemType,
    item: buildCheckItemPayload(order.catalogItemType, order.catalogItemId),
    visit: order.encounterId ? { encounterId: order.encounterId } : undefined,
  });
}

/**
 * Turns a catalog search result into a real, priced, `accepted` order — the same "pick from
 * search" path used by `PlanOrdersSection` (manual mode) and `ScribeSuggestedPlanItems` (AI
 * Scribe mode), so both entry points create identical, checkout/invoice-ready orders.
 */
export async function createOrderFromSearchItem(args: {
  encounterId: string;
  item: SearchableItem;
  patientId?: number;
  practiceId: number;
  clientId?: number;
  state?: 'accepted' | 'proposed';
  askCoverageChoice?: (prompt: CoverageChoicePrompt) => Promise<number | null>;
  bundle?: { bundleSaleId: string; sourceBundleId: number; sourceBundleName: string };
}): Promise<{ order: EncounterOrder; pricingItem: CatalogPricingItem }> {
  const {
    encounterId,
    item,
    patientId,
    practiceId,
    clientId,
    state = 'accepted',
    askCoverageChoice,
    bundle,
  } = args;
  const catalogItemType = item.itemType as EncounterOrderCatalogType;
  let pricingItem: CatalogPricingItem = item as CatalogPricingItem;
  let unitPrice = getCatalogLinePrice(pricingItem, 1).unitFinal;
  let isCovered = false;

  if (patientId != null && Number.isFinite(patientId)) {
    const request = {
      patientId,
      practiceId,
      clientId,
      itemType: item.itemType,
      item: buildCheckItemPayloadFromSearch(item),
      encounterId,
    };
    const pricingResponse = askCoverageChoice
      ? await checkItemPricingWithCoverageChoice({
          request,
          itemName: item.name,
          askCoverageChoice,
        })
      : await checkItemPricing(request);
    pricingItem = pricingItemFromSearchAndCheck(item, pricingResponse);
    const line = getCatalogLinePrice(pricingItem, 1);
    unitPrice = line.unitFinal;
    isCovered = line.isCovered;
  }

  const order = await createOrder(encounterId, {
    name: item.name,
    kind: kindForCatalogSearchItem(item),
    catalogItemId: catalogIdForSearchItem(item),
    catalogItemType,
    unitPrice,
    isCovered,
    qty: 1,
    state,
    ...bundle,
  });
  return { order, pricingItem };
}

/** Freeform "add as note" fallback when nothing in the catalog matches — same as manual mode's
 * search box (`PlanOrdersSection.addNote`). */
export async function createNoteOrder(encounterId: string, text: string): Promise<EncounterOrder> {
  return createOrder(encounterId, {
    name: text,
    note: text,
    kind: 'note',
    catalogItemType: 'custom',
    unitPrice: 0,
    state: 'accepted',
  });
}

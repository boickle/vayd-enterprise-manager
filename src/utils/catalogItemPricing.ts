import {
  checkItemPricing,
  type CheckItemPricingResponse,
  type SearchableItem,
} from '../api/roomLoader';
import type { EncounterOrder, EncounterOrderCatalogType } from '../api/visitWorkflow';

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
    const minLow = Math.min(
      ...activeBreaks.map((pb) => parseInt(String(pb.lowQuantity), 10))
    );
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

/** Total pre-discount for quantity (tiers + service-fee rules). */
export function getTotalPreDiscountForQuantity(
  item: CatalogPricingItem,
  quantity: number
): number {
  const q = Math.max(0, Number(quantity) || 0);
  const preDiscount1 = getPreDiscountForOneUnit(item);

  if (item.tieredPricing?.hasTieredPricing) {
    const tieredUnit = getTieredUnitPrice(item.tieredPricing, q, preDiscount1);
    return tieredUnit * q;
  }

  const t = String(item.itemType ?? '').toLowerCase();
  if (t === 'lab') {
    const p = Number(item.lab?.price ?? item.price ?? 0);
    return p * q;
  }
  if (t === 'procedure') {
    const p = Number(item.procedure?.price ?? item.price ?? 0);
    const sf = Number(item.procedure?.serviceFee ?? item.serviceFee ?? 0);
    return p * q + sf;
  }
  if (t === 'inventory') {
    const p = Number(item.inventoryItem?.price ?? item.price ?? 0);
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
  return Number(item.price ?? 0) * q;
}

/** Final unit/total after membership + client discount ratio (Room Loader parity). */
export function getCatalogLinePrice(
  item: CatalogPricingItem,
  quantity: number
): CatalogLinePrice {
  const preDiscount1 = getPreDiscountForOneUnit(item);
  const totalPreDiscount = getTotalPreDiscountForQuantity(item, quantity);
  const q = Math.max(1, Number(quantity) || 1);

  const adjustedFromApi = Number(item.price ?? 0);
  const originalFromApi = Number(
    item.originalPrice ?? item.wellnessPlanPricing?.originalPrice ?? preDiscount1
  );
  const discountRatio = originalFromApi > 0 ? adjustedFromApi / originalFromApi : 1;

  const totalFinal = totalPreDiscount * discountRatio;
  const unitFinal = q > 0 ? totalFinal / q : adjustedFromApi;

  const isCovered = Boolean(
    item.wellnessPlanPricing?.hasCoverage &&
      item.wellnessPlanPricing?.isWithinLimit &&
      unitFinal === 0
  );

  return { unitFinal, totalFinal, isCovered };
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

export function pricingItemFromSearchAndCheck(
  searchItem: SearchableItem,
  pricing: CheckItemPricingResponse
): CatalogPricingItem {
  return {
    itemType: searchItem.itemType,
    price: pricing.adjustedPrice ?? searchItem.price,
    originalPrice: pricing.originalPrice ?? searchItem.originalPrice ?? searchItem.price,
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
}): Promise<CatalogPricingItem> {
  const response = await checkItemPricing({
    patientId: args.patientId,
    practiceId: args.practiceId,
    clientId: args.clientId,
    itemType: args.itemType,
    item: args.item,
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
  });
}

import {
  getItemWithPriceBreaks,
  searchItems,
  type ItemWithPriceBreaks,
  type QuantityPriceBreak,
} from '../api/quantityPriceBreaks';
import {
  getPreDiscountForOneUnit,
  getTotalPreDiscountForQuantity,
  type CatalogPricingItem,
} from './catalogItemPricing';
import type { CheckItemPricingResponse } from '../api/roomLoader';
import type { RoomLoaderItemRef, RoomLoaderPanelRule } from './roomLoaderConfigTypes';

function asNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function tieredFromBreaks(
  breaks: QuantityPriceBreak[] | undefined
): CatalogPricingItem['tieredPricing'] {
  if (!breaks?.length) return undefined;
  return {
    hasTieredPricing: true,
    priceBreaks: breaks.map((row) => ({
      lowQuantity: String(row.lowQuantity),
      highQuantity: String(row.highQuantity),
      price: String(row.price),
      markup: row.markup != null ? String(row.markup) : '',
      isActive: row.isActive,
    })),
  };
}

/** Same CatalogPricingItem shape Room Loader uses for list / membership math. */
export function pricingItemFromCatalogRow(row: ItemWithPriceBreaks): CatalogPricingItem {
  const item = row.item as Record<string, unknown>;
  const tieredPricing = tieredFromBreaks(row.priceBreaks);
  if (row.itemType === 'lab') {
    return { itemType: 'lab', lab: item, price: asNumber(item.price), tieredPricing };
  }
  if (row.itemType === 'procedure') {
    return {
      itemType: 'procedure',
      procedure: item,
      price: asNumber(item.price),
      serviceFee: asNumber(item.serviceFee),
      tieredPricing,
    };
  }
  return {
    itemType: 'inventory',
    inventoryItem: item,
    price: asNumber(item.price),
    serviceFee: asNumber(item.serviceFee),
    minimumPrice: item.minimumPrice != null ? asNumber(item.minimumPrice) : undefined,
    tieredPricing,
  };
}

export function catalogListPrice(row: ItemWithPriceBreaks): number {
  return getPreDiscountForOneUnit(pricingItemFromCatalogRow(row));
}

/** Live catalog list price for a configured Room Loader item (price + service fee / minimum). */
export async function fetchCatalogListPrice(
  ref: RoomLoaderItemRef,
  practiceId: number
): Promise<number | null> {
  try {
    const row = await getItemWithPriceBreaks(ref.itemType, ref.itemId, practiceId);
    const price = catalogListPrice(row);
    return Number.isFinite(price) ? price : null;
  } catch {
    const q = (ref.code ?? '').trim() || ref.name.trim();
    if (!q) return null;
    try {
      const found = await searchItems(q, practiceId, 10);
      const match =
        found.find((row) => {
          const id =
            row.itemType === 'lab'
              ? row.lab?.id
              : row.itemType === 'procedure'
                ? row.procedure?.id
                : row.inventoryItem?.id;
          return row.itemType === ref.itemType && Number(id) === Number(ref.itemId);
        }) ?? found.find((row) => row.itemType === ref.itemType);
      if (!match) return null;
      const price = getPreDiscountForOneUnit({
        itemType: match.itemType,
        price: match.price,
        lab: match.lab ?? null,
        procedure: match.procedure ?? null,
        inventoryItem: match.inventoryItem ?? null,
      });
      return Number.isFinite(price) ? price : null;
    } catch {
      return null;
    }
  }
}

export function itemRefsFromPanelRules(rules: RoomLoaderPanelRule[]): RoomLoaderItemRef[] {
  const seen = new Set<string>();
  const out: RoomLoaderItemRef[] = [];
  for (const rule of rules) {
    for (const option of rule.options ?? []) {
      const refs = [option.item, ...(option.subAsks ?? []).map((sub) => sub.item)];
      for (const ref of refs) {
        if (!ref || !(Number(ref.itemId) > 0)) continue;
        const key = `${ref.itemType}:${ref.itemId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(ref);
      }
    }
  }
  return out;
}

export type QuantityLinePrice = { unit: number; total: number };

/**
 * RL-02b: what a Room Loader line costs at a quantity, the way the server charges it
 * (mirrors vayd-api `catalogLineTotal`): the price break for that quantity, the service
 * fee once per line, the minimum price for the whole line. `unitAtOne` is the price the
 * form already shows for one unit (member and client discounts included); the discount
 * share it carries over the catalog list price is applied to the whole line. Allowance
 * left on a covered item makes only that many units free. Without catalog data for the
 * item it falls back to unit x quantity.
 */
export function quantityLinePrice(
  pricing: CheckItemPricingResponse | null | undefined,
  unitAtOne: number,
  quantity: number
): QuantityLinePrice {
  const qty = Math.max(1, Math.floor(Number(quantity) || 1));
  const unit1 = Number.isFinite(unitAtOne) ? unitAtOne : 0;
  const simple = { unit: unit1, total: unit1 * qty };
  if (qty === 1 || !pricing?.item) return simple;

  const catalogItem = pricing.item;
  const type = String(catalogItem.itemType ?? '').toLowerCase();
  const entity =
    type === 'lab' ? catalogItem.lab : type === 'procedure' ? catalogItem.procedure : catalogItem.inventoryItem;
  if (!entity || entity.price == null) return simple;

  const priced: CatalogPricingItem = {
    itemType: type,
    price: Number(entity.price),
    lab: catalogItem.lab,
    procedure: catalogItem.procedure,
    inventoryItem: catalogItem.inventoryItem,
    tieredPricing: pricing.tieredPricing,
  };
  const listOne = getPreDiscountForOneUnit(priced);
  const listLine = getTotalPreDiscountForQuantity(priced, qty);
  if (!(listOne > 0) || !Number.isFinite(listLine)) return simple;

  const wp = pricing.wellnessPlanPricing;
  const remaining = Number(wp?.remainingQuantity);
  let total: number;
  if (unit1 === 0 && wp?.hasCoverage && Number.isFinite(remaining) && remaining >= 0 && remaining < qty) {
    // Allowance covers `remaining` units; the rest are charged at the regular line price.
    total = (listLine * (qty - remaining)) / qty;
  } else if (pricing.perUnitPrice != null && Number.isFinite(Number(pricing.perUnitPrice))) {
    total = Math.min(listLine, Math.max(0, Number(pricing.perUnitPrice)) * qty);
  } else {
    total = listLine * (unit1 / listOne);
  }
  return { unit: total / qty, total };
}

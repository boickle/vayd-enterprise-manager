// Proposed practice-level inventory catalog endpoints (online store, units, bulk pricing, cost rollups).
import { http } from './http';

export type SellUnitType =
  | 'capsule'
  | 'tablet'
  | 'bottle'
  | 'package'
  | 'ml'
  | 'gram'
  | 'each'
  | 'other';

export type InventoryItemCatalogPatch = {
  showOnOnlineStore?: boolean;
  onlineStorePrice?: number | null;
  sellUnitType?: SellUnitType | string | null;
  /** When sellUnitType is `other`, free-text label (e.g. "vial"). */
  sellUnitTypeDetail?: string | null;
  /** e.g. 100 when selling by bottle of 100 capsules. */
  unitsPerPackage?: number | null;
  /** Secondary way you sell the same SKU (e.g. capsule when primary is bottle). */
  alternateSellUnitType?: SellUnitType | string | null;
  alternateUnitsPerPackage?: number | null;
};

export async function patchPracticeInventoryItem(
  practiceId: number,
  inventoryItemId: number,
  body: InventoryItemCatalogPatch
): Promise<Record<string, unknown>> {
  const { data } = await http.patch<Record<string, unknown>>(
    `/practice/${practiceId}/inventory-items/${inventoryItemId}`,
    body
  );
  return data ?? {};
}

export type BulkInventoryPriceAdjustBody = {
  inventoryItemIds: number[];
  /** Positive = increase, negative = decrease, e.g. 5 = +5%. */
  percentChangePracticePrice?: number | null;
  percentChangeOnlineStorePrice?: number | null;
  flatAddPracticePrice?: number | null;
  flatAddOnlineStorePrice?: number | null;
};

export async function postBulkInventoryPriceAdjust(
  practiceId: number,
  body: BulkInventoryPriceAdjustBody
): Promise<{ updated?: number; rows?: unknown[] }> {
  const { data } = await http.post<{ updated?: number; rows?: unknown[] }>(
    `/practice/${practiceId}/inventory-items/bulk-price-adjust`,
    body
  );
  return data ?? {};
}

export type InventoryCostSummaryLocationRow = {
  branchLocationId: number | null;
  code: string;
  name: string;
  extendedCost: number;
  quantityOnHand?: number;
};

export type InventoryCostSummary = {
  branchId: number;
  practiceId?: number;
  totalExtendedCost: number;
  byLocation: InventoryCostSummaryLocationRow[];
};

export async function getInventoryCostSummary(
  practiceId: number,
  branchId: number
): Promise<InventoryCostSummary> {
  const { data } = await http.get<InventoryCostSummary>(
    `/practice/${practiceId}/branches/${branchId}/inventory-cost-summary`
  );
  return data;
}

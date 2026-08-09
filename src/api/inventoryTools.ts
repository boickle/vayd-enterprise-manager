// Proposed practice-level inventory catalog endpoints (online store, units, bulk pricing, cost rollups).
import { apiBaseUrl, http } from './http';

export type SellUnitType =
  | 'capsule'
  | 'tablet'
  | 'bottle'
  | 'package'
  | 'ml'
  | 'gram'
  | 'each'
  | 'other';

export type InventoryVaccineDetails = {
  name?: string | null;
  manufacturer?: string | null;
  vaccineType?: string | null;
  dosageType?: 'initial' | 'booster' | string | null;
  createRabiesCertificate?: boolean;
  createVaccinationLog?: boolean;
  usdaLicensingMonths?: number | null;
  animalControlLicensingMonths?: number | null;
  tagIssuePeriodMonths?: number | null;
  defaultSerial?: string | null;
};

export type InventoryItemCatalogPatch = {
  name?: string;
  code?: string | null;
  price?: number | null;
  cost?: number | null;
  serviceFee?: number | null;
  minimumPrice?: number | null;
  isMedication?: boolean;
  isActive?: boolean;
  description?: string | null;
  shippable?: boolean;
  /** Set null to clear; prefer uploadInventoryItemImage for files. */
  imageUrl?: string | null;
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
  /** Stock item this code draws down. Null means it draws on itself. */
  linkedInventoryItemId?: number | null;
  /** Units of the stock item consumed per unit sold (100 for a bottle of 100). */
  linkedInventoryItemDefaultQuantity?: number | null;
  manufacturer?: string | null;
  vendorName?: string | null;
  vendorDrugNumber?: string | null;
  barcode?: string | null;
  requireExpirationOnLots?: boolean;
  trackLots?: boolean;
  isVaccine?: boolean;
  isDispensable?: boolean;
  dispenseNote?: string | null;
  isControlled?: boolean;
  isMicrochip?: boolean;
  hasClientNotes?: boolean;
  clientNote?: string | null;
  hideOnInvoice?: boolean;
  hideOnMedicalRecordView?: boolean;
  hideOnMedicalRecordPrint?: boolean;
  excludeFromProduction?: boolean;
  allowPriceChange?: boolean;
  changePatientStatusTo?: string | null;
  changePatientSex?: boolean;
  defaultQuantity?: number | null;
  vaccineDetails?: InventoryVaccineDetails | null;
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

export async function uploadInventoryItemImage(
  practiceId: number,
  inventoryItemId: number,
  file: File
): Promise<{ success?: boolean; imageUrl?: string; s3Key?: string }> {
  const form = new FormData();
  form.append('file', file);
  const { data } = await http.post<{
    success?: boolean;
    imageUrl?: string;
    s3Key?: string;
  }>(`/practice/${practiceId}/inventory-items/${inventoryItemId}/image`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data ?? {};
}

export async function deleteInventoryItemImage(
  practiceId: number,
  inventoryItemId: number
): Promise<Record<string, unknown>> {
  const { data } = await http.delete<Record<string, unknown>>(
    `/practice/${practiceId}/inventory-items/${inventoryItemId}/image`
  );
  return data ?? {};
}

export function inventoryItemImageUrl(
  practiceId: number,
  inventoryItemId: number,
  cacheBust?: number | string
): string {
  const base = `${apiBaseUrl.replace(/\/+$/, '')}/practice/${practiceId}/inventory-items/${inventoryItemId}/image`;
  return cacheBust != null ? `${base}?t=${cacheBust}` : base;
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

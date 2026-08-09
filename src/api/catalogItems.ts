import { http } from './http';
import type { ItemType } from './quantityPriceBreaks';

export type CatalogCoreFields = {
  name?: string;
  code?: string | null;
  price?: number | null;
  cost?: number | null;
  serviceFee?: number | null;
  minimumPrice?: number | null;
  category?: number | null;
  taxLevelValue?: number | null;
  excludePercentageDiscount?: boolean;
  isMedication?: boolean;
  isActive?: boolean;
  description?: string | null;
  linkedInventoryItemId?: number | null;
  linkedInventoryItemDefaultQuantity?: number | null;
};

function pathFor(itemType: ItemType, practiceId: number, id?: number): string {
  const base =
    itemType === 'lab'
      ? `/practice/${practiceId}/labs`
      : itemType === 'procedure'
        ? `/practice/${practiceId}/procedures`
        : `/practice/${practiceId}/inventory-items`;
  return id != null ? `${base}/${id}` : base;
}

export async function createCatalogItem(
  itemType: ItemType,
  practiceId: number,
  body: CatalogCoreFields & Record<string, unknown>
): Promise<Record<string, unknown>> {
  const { data } = await http.post<Record<string, unknown>>(
    pathFor(itemType, practiceId),
    body
  );
  return data ?? {};
}

export async function patchCatalogItem(
  itemType: ItemType,
  practiceId: number,
  itemId: number,
  body: CatalogCoreFields & Record<string, unknown>
): Promise<Record<string, unknown>> {
  const { data } = await http.patch<Record<string, unknown>>(
    pathFor(itemType, practiceId, itemId),
    body
  );
  return data ?? {};
}

export async function setCatalogItemActive(
  itemType: ItemType,
  practiceId: number,
  itemId: number,
  isActive: boolean
): Promise<Record<string, unknown>> {
  return patchCatalogItem(itemType, practiceId, itemId, { isActive });
}

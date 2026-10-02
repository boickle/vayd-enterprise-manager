import { http } from './http';
import type { ItemType } from './quantityPriceBreaks';

export type CatalogCategory = {
  id: number;
  pimsId: string | null;
  name: string;
  description: string | null;
  itemType: ItemType;
  isActive: boolean;
};

/** List eVet-imported categories for a catalog item type. */
export async function listCatalogCategories(
  practiceId: number,
  itemType: ItemType
): Promise<CatalogCategory[]> {
  const { data } = await http.get<CatalogCategory[]>(
    `/practice/${practiceId}/catalog-categories`,
    { params: { itemType } }
  );
  return Array.isArray(data) ? data : [];
}

/** Resolve select value: eVet Category_Id is stored as pimsId on the category row. */
export function categorySelectValue(
  raw: number | string | null | undefined
): string {
  if (raw == null || String(raw).trim() === '') return '';
  const n = Number(raw);
  return Number.isFinite(n) ? String(Math.trunc(n)) : '';
}

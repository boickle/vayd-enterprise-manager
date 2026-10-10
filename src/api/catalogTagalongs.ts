import { http } from './http';

export type CatalogTagalongTaxMode = 'after_tax' | 'before_tax';
export type CatalogTagalongQtyMode = 'fixed' | 'match_trigger';

export type CatalogTagalong = {
  id: number;
  practiceId: number;
  triggerItemType: string;
  triggerItemId: number;
  addItemType: string;
  addItemId: number;
  addItemName: string | null;
  addItemCode: string | null;
  addItemPrice: number | null;
  minQty: number;
  maxQty: number | null;
  addQty: number;
  addQtyMode: CatalogTagalongQtyMode;
  taxMode: CatalogTagalongTaxMode;
  isActive: boolean;
  includeInOnlineStore: boolean;
  sortOrder: number;
};

export type UpsertCatalogTagalong = {
  triggerItemType: string;
  triggerItemId: number;
  addItemType: string;
  addItemId: number;
  minQty?: number;
  maxQty?: number | null;
  addQty?: number;
  addQtyMode?: CatalogTagalongQtyMode;
  taxMode?: CatalogTagalongTaxMode;
  isActive?: boolean;
  includeInOnlineStore?: boolean;
  sortOrder?: number;
};

export async function listCatalogTagalongs(
  practiceId: number,
  itemType: string,
  itemId: number
): Promise<CatalogTagalong[]> {
  const { data } = await http.get<CatalogTagalong[]>(
    `/practice/${practiceId}/catalog-tagalongs`,
    { params: { itemType, itemId } }
  );
  return Array.isArray(data) ? data : [];
}

export async function createCatalogTagalong(
  practiceId: number,
  body: UpsertCatalogTagalong
): Promise<CatalogTagalong> {
  const { data } = await http.post<CatalogTagalong>(
    `/practice/${practiceId}/catalog-tagalongs`,
    body
  );
  return data;
}

export async function updateCatalogTagalong(
  practiceId: number,
  id: number,
  body: Partial<UpsertCatalogTagalong>
): Promise<CatalogTagalong> {
  const { data } = await http.patch<CatalogTagalong>(
    `/practice/${practiceId}/catalog-tagalongs/${id}`,
    body
  );
  return data;
}

export async function deleteCatalogTagalong(
  practiceId: number,
  id: number
): Promise<void> {
  await http.delete(`/practice/${practiceId}/catalog-tagalongs/${id}`);
}

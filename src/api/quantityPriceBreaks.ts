// src/api/quantityPriceBreaks.ts
import { http } from './http';

export type ItemType = 'inventory' | 'lab' | 'procedure';

export type InventoryItem = {
  id: number;
  name: string;
  price: string;
  code: string | null;
  created?: string;
  updated?: string;
  externalCreated?: string;
  externalUpdated?: string;
  isActive?: boolean;
  pimsId?: string;
  pimsType?: string;
  isDeleted?: boolean;
  description?: string;
  serviceFee?: string;
  category?: string;
  cost?: string;
  isMedication?: boolean;
  minimumPrice?: string;
  [key: string]: any; // Allow additional fields
};

export type Lab = {
  id: number;
  name: string;
  price: string;
  code: string | null;
  [key: string]: any; // Allow additional fields
};

export type Procedure = {
  id: number;
  name: string;
  price: string;
  code: string | null;
  [key: string]: any; // Allow additional fields
};

export type SearchResultItem = {
  itemType: ItemType;
  inventoryItem?: InventoryItem;
  lab?: Lab;
  procedure?: Procedure;
  price: number;
  name: string;
  code: string | null;
};

export type QuantityPriceBreak = {
  id: number;
  created: string;
  updated: string;
  isActive: boolean;
  price: number;
  markup: number | null;
  lowQuantity: number;
  highQuantity: number;
  inventoryItem: InventoryItem | null;
  procedure: Procedure | null;
  lab: Lab | null;
  practice: {
    id: number;
    name: string;
  };
};

export type ItemWithPriceBreaks = {
  itemType: ItemType;
  item: InventoryItem | Lab | Procedure;
  priceBreaks: QuantityPriceBreak[];
};

/**
 * Search for inventory items, labs, and procedures that can have quantity price breaks
 * GET /quantity-price-breaks/items/search
 */
export async function searchItems(
  query: string,
  practiceId: number,
  limit: number = 50
): Promise<SearchResultItem[]> {
  const { data } = await http.get('/quantity-price-breaks/items/search', {
    params: {
      q: query,
      practiceId,
      limit,
    },
  });
  return Array.isArray(data) ? data : [];
}

/**
 * Get an item (inventory, lab, or procedure) along with all its associated quantity price breaks
 * GET /quantity-price-breaks/item/:itemType/:itemId?practiceId=
 */
export async function getItemWithPriceBreaks(
  itemType: ItemType,
  itemId: number,
  practiceId: number
): Promise<ItemWithPriceBreaks> {
  const { data } = await http.get(
    `/quantity-price-breaks/item/${itemType}/${itemId}`,
    {
      params: {
        practiceId,
      },
    }
  );
  // Ensure priceBreaks is always an array
  if (data && !Array.isArray(data.priceBreaks)) {
    data.priceBreaks = data.priceBreaks || [];
  }
  return data;
}

/**
 * Create a new quantity price break for an item
 * POST /quantity-price-breaks
 */
export async function createQuantityPriceBreak(
  itemType: ItemType,
  itemId: number,
  practiceId: number,
  price: number,
  lowQuantity: number,
  highQuantity: number,
  markup?: number | null,
  isActive: boolean = true
): Promise<QuantityPriceBreak> {
  const { data } = await http.post('/quantity-price-breaks', {
    itemType,
    itemId,
    practiceId,
    price,
    markup: markup ?? null,
    lowQuantity,
    highQuantity,
    isActive,
  });
  return data;
}

/**
 * Update an existing quantity price break
 * PUT /quantity-price-breaks/:id
 */
export async function updateQuantityPriceBreak(
  id: number,
  updates: {
    price?: number;
    markup?: number | null;
    lowQuantity?: number;
    highQuantity?: number;
    isActive?: boolean;
  }
): Promise<QuantityPriceBreak> {
  const { data } = await http.put(`/quantity-price-breaks/${id}`, updates);
  return data;
}

/**
 * Delete (soft delete) a quantity price break by setting isActive to false
 * DELETE /quantity-price-breaks/:id
 */
export async function deleteQuantityPriceBreak(
  id: number
): Promise<{ message: string }> {
  const { data } = await http.delete(`/quantity-price-breaks/${id}`);
  return data;
}

/**
 * List all quantity price breaks, optionally filtered
 * GET /quantity-price-breaks
 */
export async function listQuantityPriceBreaks(
  filters?: {
    itemType?: ItemType;
    itemId?: number;
    practiceId?: number;
  }
): Promise<QuantityPriceBreak[]> {
  const { data } = await http.get('/quantity-price-breaks', {
    params: filters,
  });
  return Array.isArray(data) ? data : [];
}

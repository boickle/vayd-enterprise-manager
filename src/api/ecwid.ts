import { http } from './http';

/** Single choice for a product option (e.g. "4.1 - 17 lb - 1 dose (1 month's worth)"). */
export type EcwidChoice = {
  text: string;
  textTranslated?: { en?: string; [lang: string]: string | undefined };
  priceModifier?: number;
  priceModifierType?: string;
};

/** Product attribute (e.g. "Master product options" with value "# doses: 4.1 - 17 lb - 6 doses (6 months' worth)"). */
export type EcwidAttribute = {
  id?: number;
  name?: string;
  nameTranslated?: { en?: string; [lang: string]: string | undefined };
  value?: string;
  valueTranslated?: { en?: string; [lang: string]: string | undefined };
};

/** One variant of a product when product uses combinations (e.g. Size option with price per size). */
export type EcwidCombination = {
  id?: number;
  combinationNumber?: number;
  options?: Array<{
    name?: string;
    nameTranslated?: { en?: string };
    value?: string;
    valueTranslated?: { en?: string };
  }>;
  price?: number;
  defaultDisplayedPrice?: number;
  defaultDisplayedPriceFormatted?: string;
  inStock?: boolean;
  unlimited?: boolean;
  attributes?: EcwidAttribute[];
  [key: string]: unknown;
};

export type EcwidProduct = {
  id: number | string;
  name: string;
  price: number;
  sku?: string;
  /** Option choices for this variation (e.g. "# doses", "Size"). */
  options?: Array<{ name?: string; value?: string; choices?: EcwidChoice[] }>;
  /** Product choices (dose/size options). Exclude question-like entries when displaying. */
  choices?: EcwidChoice[];
  /** Attributes (e.g. "Master product options" = dose/weight description for modal display). */
  attributes?: EcwidAttribute[];
  /** Variants with their own option value and price (e.g. Size: 4.4-6 lb, 6.1-12 lb, ...). */
  combinations?: EcwidCombination[];
  [key: string]: unknown;
};

/** Ecwid API list response: products are in `items`. */
type EcwidProductsResponse = {
  total?: number;
  count?: number;
  offset?: number;
  limit?: number;
  items?: EcwidProduct[];
  products?: EcwidProduct[];
};

/**
 * Search store products from Ecwid.
 * GET /public/ecwid/products?q=searchTerm
 * Response: { total, count, offset, limit, items: EcwidProduct[] }
 */
export async function getEcwidProducts(searchQuery: string): Promise<EcwidProduct[]> {
  if (!searchQuery.trim()) return [];
  const { data } = await http.get<EcwidProduct[] | EcwidProductsResponse>(
    '/public/ecwid/products',
    { params: { q: searchQuery.trim() } }
  );
  if (Array.isArray(data)) return data;
  const obj = data as EcwidProductsResponse;
  if (obj && typeof obj === 'object') {
    if (Array.isArray(obj.items)) return obj.items;
    if (Array.isArray(obj.products)) return obj.products;
  }
  return [];
}

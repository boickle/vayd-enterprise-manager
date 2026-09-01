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

/** Category assignment on an Ecwid product (API may return nameTranslated as string or map). */
export type EcwidCategoryRef = {
  id?: number;
  enabled?: boolean;
  name?: string;
  nameTranslated?: string | { en?: string; [lang: string]: string | undefined };
  ancestorIds?: number[];
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
  /** Category IDs the product belongs to. */
  categoryIds?: number[];
  /** Detailed categories (used to exclude subscription "Clones" from room-loader search). */
  categories?: EcwidCategoryRef[];
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

function ecwidCategoryDisplayName(cat: EcwidCategoryRef | null | undefined): string {
  if (!cat || typeof cat !== 'object') return '';
  const translated = cat.nameTranslated;
  if (typeof translated === 'string' && translated.trim()) return translated.trim();
  if (translated && typeof translated === 'object') {
    const en = translated.en;
    if (typeof en === 'string' && en.trim()) return en.trim();
  }
  return typeof cat.name === 'string' ? cat.name.trim() : '';
}

/**
 * Subscription/autoship clone products live in Ecwid categories named like
 * "Revolution Plus Topical for Cats – Clones". Those must not appear in the
 * public room-loader additional-items search (they look like autoship + wrong SKU/price).
 */
export function isEcwidCloneCategoryName(name: string | null | undefined): boolean {
  const s = (name ?? '').trim();
  if (!s) return false;
  return /\bclones?\b/i.test(s);
}

/** True when the product is assigned to any category whose name includes Clone/Clones. */
export function isEcwidCloneCategoryProduct(product: EcwidProduct | null | undefined): boolean {
  if (!product) return false;
  const cats = product.categories;
  if (!Array.isArray(cats) || cats.length === 0) return false;
  return cats.some((c) => isEcwidCloneCategoryName(ecwidCategoryDisplayName(c)));
}

/** Drop subscription Clone-category products from an Ecwid search result list. */
export function filterOutEcwidCloneProducts(products: EcwidProduct[]): EcwidProduct[] {
  if (!Array.isArray(products) || products.length === 0) return [];
  return products.filter((p) => !isEcwidCloneCategoryProduct(p));
}

/**
 * Search store products from Ecwid.
 * GET /public/ecwid/products?q=searchTerm
 * Response: { total, count, offset, limit, items: EcwidProduct[] }
 *
 * Filters out products in "Clone(s)" categories (subscription SKU mirrors).
 */
export async function getEcwidProducts(searchQuery: string): Promise<EcwidProduct[]> {
  if (!searchQuery.trim()) return [];
  const { data } = await http.get<EcwidProduct[] | EcwidProductsResponse>(
    '/public/ecwid/products',
    { params: { q: searchQuery.trim() } }
  );
  let items: EcwidProduct[] = [];
  if (Array.isArray(data)) {
    items = data;
  } else {
    const obj = data as EcwidProductsResponse;
    if (obj && typeof obj === 'object') {
      if (Array.isArray(obj.items)) items = obj.items;
      else if (Array.isArray(obj.products)) items = obj.products;
    }
  }
  return filterOutEcwidCloneProducts(items);
}

import type { SearchableItem } from '../api/roomLoader';

/** One constituent line on a room-loader package search hit (prices already allocated to the package total). */
export type PackageSearchLineItem = {
  itemType?: string;
  name?: string;
  price?: number | string | null;
  code?: string | null;
  inventoryItem?: Record<string, unknown> | null;
  lab?: Record<string, unknown> | null;
  procedure?: Record<string, unknown> | null;
  /** Some API payloads nest the catalog row. */
  item?: {
    itemType?: string;
    type?: string;
    name?: string;
    price?: number | string | null;
    code?: string | null;
    inventoryItem?: Record<string, unknown> | null;
    lab?: Record<string, unknown> | null;
    procedure?: Record<string, unknown> | null;
    id?: number | null;
  } | null;
};

export function isRoomLoaderPackageSearchItem(item: SearchableItem | null | undefined): boolean {
  return String(item?.itemType ?? '')
    .trim()
    .toLowerCase() === 'package';
}

function packageLineToSearchableItem(raw: PackageSearchLineItem): SearchableItem | null {
  const nested = raw?.item && typeof raw.item === 'object' ? raw.item : null;
  const itemType = String(
    raw?.itemType ?? nested?.itemType ?? nested?.type ?? 'procedure'
  )
    .trim()
    .toLowerCase();
  if (!itemType || itemType === 'package') return null;

  const name = String(raw?.name ?? nested?.name ?? '').trim();
  if (!name) return null;

  const priceRaw = raw?.price ?? nested?.price;
  const priceNum = priceRaw != null && priceRaw !== '' ? Number(priceRaw) : 0;
  const price = Number.isFinite(priceNum) ? priceNum : 0;
  const codeRaw = raw?.code ?? nested?.code;
  const code =
    codeRaw != null && String(codeRaw).trim() !== '' ? String(codeRaw).trim() : undefined;

  const inventoryItem = (raw?.inventoryItem ?? nested?.inventoryItem ?? undefined) as
    | SearchableItem['inventoryItem']
    | undefined;
  const lab = (raw?.lab ?? nested?.lab ?? undefined) as SearchableItem['lab'] | undefined;
  const procedure = (raw?.procedure ?? nested?.procedure ?? undefined) as
    | Record<string, unknown>
    | undefined;

  // If API only sent a bare catalog id on nested.item, synthesize a minimal row so payload ids work.
  let inv = inventoryItem;
  let lb = lab;
  let proc = procedure;
  const nestedId = nested?.id;
  if (nestedId != null && Number.isFinite(Number(nestedId))) {
    const idNum = Number(nestedId);
    if (itemType === 'inventory' && inv == null) inv = { id: idNum, name, code };
    else if (itemType === 'lab' && lb == null) lb = { id: idNum, name, code };
    else if (itemType === 'procedure' && proc == null) proc = { id: idNum, name, code };
  }

  const out: SearchableItem = {
    itemType,
    name,
    price,
    originalPrice: price,
    ...(code ? { code } : {}),
  };
  if (inv) out.inventoryItem = inv;
  if (lb) out.lab = lb;
  if (proc) (out as SearchableItem & { procedure?: Record<string, unknown> }).procedure = proc;
  return out;
}

/**
 * When staff pick a package from room-loader item search, expand into constituent catalog lines
 * whose prices already sum to the package total (e.g. Happy Cat Pack → four lines totaling $18).
 * Non-packages and packages without usable `packageItems` return the original row alone.
 */
export function expandPackageSearchItem(item: SearchableItem): SearchableItem[] {
  if (!isRoomLoaderPackageSearchItem(item)) return [item];

  const rawLines = (item as SearchableItem & { packageItems?: PackageSearchLineItem[] }).packageItems;
  if (!Array.isArray(rawLines) || rawLines.length === 0) return [item];

  const expanded: SearchableItem[] = [];
  for (const line of rawLines) {
    const si = packageLineToSearchableItem(line);
    if (si) expanded.push(si);
  }
  return expanded.length > 0 ? expanded : [item];
}

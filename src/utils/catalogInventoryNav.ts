/** Catalog = what the practice charges for. Pharmacy = stock, store, and mail fulfillment. */

export const CATALOG_HOME = '/schedule/inventory/items';
export const INVENTORY_HOME = '/schedule/inventory/receive';

const PHARMACY_SEGMENTS = new Set([
  'par-levels',
  'counts',
  'full-count',
  'count-report',
  'receive',
  'move',
  'waste',
  'activity',
  'fill-list',
  'order-list',
  'transfer-list',
  'online-store',
  'store-categories',
  'abandoned-carts',
]);

function inventorySegment(pathname: string): string | null {
  const match = pathname.match(/^\/schedule\/inventory\/([^/]+)/);
  return match?.[1] ?? null;
}

export function isInventoryOpsNavPath(pathname: string): boolean {
  if (pathname === '/schedule/mail-orders' || pathname.startsWith('/schedule/mail-orders/')) {
    return true;
  }
  const segment = inventorySegment(pathname);
  return segment != null && PHARMACY_SEGMENTS.has(segment);
}

export function isCatalogNavPath(pathname: string): boolean {
  if (pathname.startsWith('/schedule/procedures') || pathname.startsWith('/schedule/labs')) {
    return true;
  }
  if (pathname === '/schedule/inventory' || pathname === '/schedule/inventory/') {
    return true;
  }
  return pathname.startsWith('/schedule/inventory') && !isInventoryOpsNavPath(pathname);
}

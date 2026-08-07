import { searchItems, type SearchableItem } from '../api/roomLoader';
import type { EncounterOrder } from '../api/visitWorkflow';
import { createOrderFromSearchItem } from './catalogItemPricing';
import {
  inventoryCategoryRequiresSharpsDisposal,
  isVaccineInventoryCategory,
  labCodeRequiresSharpsDisposal,
} from './roomLoaderSharps';

export function inventoryCategoryName(item: SearchableItem): string | null {
  if (item.itemType !== 'inventory') return null;
  const cat = (item.inventoryItem as { categoryName?: string } | null | undefined)?.categoryName;
  return typeof cat === 'string' && cat.trim() ? cat.trim() : null;
}

export function isVaccineSearchItem(item: SearchableItem): boolean {
  return isVaccineInventoryCategory(inventoryCategoryName(item));
}

/** Vaccines + injectable inventory (and non-exempt labs) need a SHARPS disposal line. */
export function searchItemRequiresSharpsFee(item: SearchableItem): boolean {
  if (item.itemType === 'inventory') {
    return inventoryCategoryRequiresSharpsDisposal(inventoryCategoryName(item));
  }
  if (item.itemType === 'lab') {
    const code = item.code ?? (item.lab as { code?: string } | null | undefined)?.code ?? null;
    return labCodeRequiresSharpsDisposal(code);
  }
  return false;
}

export function isSharpsOrderName(name: string | null | undefined): boolean {
  const n = (name ?? '').trim().toLowerCase();
  if (!n) return false;
  return n === 'sharps' || n.includes('sharps');
}

export function ordersAlreadyIncludeSharps(
  orders: ReadonlyArray<Pick<EncounterOrder, 'name' | 'state'>>
): boolean {
  return orders.some((o) => o.state !== 'declined' && isSharpsOrderName(o.name));
}

function pickSharpsSearchResult(rows: SearchableItem[]): SearchableItem | null {
  const exact = rows.find((it) => {
    const code = (it.code ?? it.inventoryItem?.code ?? '').toString().toUpperCase();
    return code === 'SHARPS';
  });
  if (exact) return exact;
  return (
    rows.find((it) => isSharpsOrderName(it.name)) ??
    rows.find((it) => it.itemType === 'inventory') ??
    null
  );
}

/**
 * Adds the catalog SHARPS fee when the trigger item needs disposal and the visit does not
 * already have one. Returns the new order, or null when nothing was added.
 */
export async function ensureSharpsFeeOrder(args: {
  encounterId: string;
  practiceId: number;
  patientId?: number;
  clientId?: number;
  existingOrders: ReadonlyArray<Pick<EncounterOrder, 'name' | 'state'>>;
  triggerItem: SearchableItem;
}): Promise<EncounterOrder | null> {
  if (!searchItemRequiresSharpsFee(args.triggerItem)) return null;
  if (ordersAlreadyIncludeSharps(args.existingOrders)) return null;

  const rows = await searchItems({
    q: 'SHARPS',
    code: 'SHARPS',
    practiceId: args.practiceId,
    limit: 10,
    patientId: args.patientId,
    clientId: args.clientId,
  });
  const sharpsItem = pickSharpsSearchResult(rows);
  if (!sharpsItem) return null;

  const { order } = await createOrderFromSearchItem({
    encounterId: args.encounterId,
    item: sharpsItem,
    patientId: args.patientId,
    practiceId: args.practiceId,
    clientId: args.clientId,
  });
  return order;
}

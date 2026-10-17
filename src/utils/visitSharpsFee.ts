import type { SearchableItem } from '../api/roomLoader';
import { isVaccineInventoryCategory } from './roomLoaderSharps';

// The sharps disposal fee itself is added and removed by the API alongside needle items.

export function inventoryCategoryName(item: SearchableItem): string | null {
  if (item.itemType !== 'inventory') return null;
  const cat = (item.inventoryItem as { categoryName?: string } | null | undefined)?.categoryName;
  return typeof cat === 'string' && cat.trim() ? cat.trim() : null;
}

export function isVaccineSearchItem(item: SearchableItem): boolean {
  if (item.itemType === 'inventory') {
    const inv = item.inventoryItem as { isVaccine?: boolean } | null | undefined;
    if (inv?.isVaccine === true) return true;
  }
  return isVaccineInventoryCategory(inventoryCategoryName(item));
}

export function isSharpsOrderName(name: string | null | undefined): boolean {
  const n = (name ?? '').trim().toLowerCase();
  if (!n) return false;
  return n === 'sharps' || n.includes('sharps');
}

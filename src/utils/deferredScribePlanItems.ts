import type { SuggestedPlanItem } from '../components/soap/ScribeSuggestedPlanItems';

/**
 * A multi-pet Scribe pass produces plan items for housemates whose chart isn't open, and those
 * items must not become unpriced orders — they need the same catalog-match step the open pet
 * gets in `ScribeSuggestedPlanItems`. They're parked here until that pet's tab is opened.
 *
 * Read-once by design: the Plan narrative is saved on the other pet's encounter, so
 * `extractPlanNarrativeItems` re-derives the same rows after a reload. Keeping the stash around
 * would instead resurrect items the doctor already resolved.
 */
const STORAGE_PREFIX = 'vayd.scribe.deferredPlanItems.';

function storageKey(encounterId: string): string {
  return `${STORAGE_PREFIX}${encounterId}`;
}

export function stashDeferredPlanItems(encounterId: string, items: SuggestedPlanItem[]): void {
  if (!encounterId || items.length === 0) return;
  try {
    sessionStorage.setItem(storageKey(encounterId), JSON.stringify(items));
  } catch {
    /* private mode / quota — deferring is best-effort */
  }
}

export function takeDeferredPlanItems(encounterId: string): SuggestedPlanItem[] {
  if (!encounterId) return [];
  try {
    const raw = sessionStorage.getItem(storageKey(encounterId));
    if (!raw) return [];
    sessionStorage.removeItem(storageKey(encounterId));
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is SuggestedPlanItem =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as SuggestedPlanItem).key === 'string' &&
        typeof (item as SuggestedPlanItem).name === 'string'
    );
  } catch {
    return [];
  }
}

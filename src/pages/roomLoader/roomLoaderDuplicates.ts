import type { ReminderWithPrice, SearchableItem } from '../../api/roomLoader';

/**
 * RL-17: an item already on the pet's Room Loader list (an added item, or a reminder's
 * matched or corrected item) is refused when staff add it again, not only at Send.
 */
function key(id: unknown, type: unknown): string | null {
  const n = Number(id);
  return id != null && Number.isFinite(n) && n > 0
    ? `${String(type ?? '').toLowerCase()}:${n}`
    : null;
}

export function searchableCatalogKey(item: SearchableItem | null | undefined): string | null {
  if (!item) return null;
  return key(
    item.inventoryItem?.id ??
      item.lab?.id ??
      (item as { procedure?: { id?: number } }).procedure?.id,
    item.itemType
  );
}

export function itemAlreadyOnPetList(
  item: SearchableItem,
  added: SearchableItem[],
  reminders: ReminderWithPrice[],
  removedReminderIds: ReadonlySet<number>,
  correctionFor: (reminderId: number) => SearchableItem | null | undefined
): boolean {
  const wanted = searchableCatalogKey(item);
  if (!wanted) return false;
  if (added.some((a) => searchableCatalogKey(a) === wanted)) return true;
  return reminders.some((r) => {
    const id = r.reminder?.id;
    if (id == null || removedReminderIds.has(id)) return false;
    const corrected = correctionFor(id);
    const k = corrected ? searchableCatalogKey(corrected) : key(r.matchedItem?.id, r.itemType);
    return k === wanted;
  });
}

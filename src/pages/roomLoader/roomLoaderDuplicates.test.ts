import { describe, expect, it } from 'vitest';
import { itemAlreadyOnPetList, searchableCatalogKey } from './roomLoaderDuplicates';
import type { ReminderWithPrice, SearchableItem } from '../../api/roomLoader';

const inv = (id: number, name = `Item ${id}`): SearchableItem =>
  ({ itemType: 'inventory', name, price: 1, inventoryItem: { id } }) as SearchableItem;
const proc = (id: number): SearchableItem =>
  ({ itemType: 'procedure', name: 'P', price: 1, procedure: { id } }) as SearchableItem;
const reminder = (rid: number, matchedId: number, itemType = 'inventory') =>
  ({
    reminder: { id: rid, description: 'r' },
    matchedItem: { id: matchedId, name: 'm' },
    itemType,
  }) as unknown as ReminderWithPrice;

describe('RL-17 duplicate refused when added', () => {
  it('an item already added for the pet', () => {
    expect(itemAlreadyOnPetList(inv(5), [inv(5)], [], new Set(), () => null)).toBe(true);
  });
  it("a reminder's matched item, unless that reminder was removed", () => {
    expect(itemAlreadyOnPetList(inv(7), [], [reminder(1, 7)], new Set(), () => null)).toBe(true);
    expect(itemAlreadyOnPetList(inv(7), [], [reminder(1, 7)], new Set([1]), () => null)).toBe(
      false
    );
  });
  it("a reminder's corrected item counts, its old match does not", () => {
    expect(itemAlreadyOnPetList(inv(9), [], [reminder(1, 7)], new Set(), () => inv(9))).toBe(true);
    expect(itemAlreadyOnPetList(inv(7), [], [reminder(1, 7)], new Set(), () => inv(9))).toBe(false);
  });
  it('same id but another catalog type is not a duplicate', () => {
    expect(itemAlreadyOnPetList(proc(5), [inv(5)], [], new Set(), () => null)).toBe(false);
  });
  it('an item with no catalog id is never refused', () => {
    expect(
      searchableCatalogKey({ itemType: 'procedure', name: 'x', price: 0 } as SearchableItem)
    ).toBeNull();
    expect(
      itemAlreadyOnPetList(
        { itemType: 'procedure', name: 'x', price: 0 } as SearchableItem,
        [],
        [],
        new Set(),
        () => null
      )
    ).toBe(false);
  });
});

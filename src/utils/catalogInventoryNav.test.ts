import { describe, expect, it } from 'vitest';
import { isCatalogNavPath, isInventoryOpsNavPath } from './catalogInventoryNav';

describe('catalogInventoryNav', () => {
  it.each(['gift-cards', 'autoship-import', 'auto-ships', 'online-store'])(
    'store page %s highlights Pharmacy, not Catalog',
    (segment) => {
      const path = `/schedule/inventory/${segment}`;
      expect(isInventoryOpsNavPath(path)).toBe(true);
      expect(isCatalogNavPath(path)).toBe(false);
    }
  );

  it('items stays under Catalog', () => {
    expect(isCatalogNavPath('/schedule/inventory/items')).toBe(true);
    expect(isInventoryOpsNavPath('/schedule/inventory/items')).toBe(false);
  });
});

/**
 * INV-A15: shelves that haven't had their first count sit at 0 or below (owner decision D4),
 * so the Order List and Transfer List must not suggest anything for them until they're counted.
 */
import { describe, expect, it } from 'vitest';
import { planStockLists } from './syncFillList';
import type { BranchParItem } from '../api/branchInventory';

const item = (over: Partial<BranchParItem> & { mainCounted: boolean; carCounted: boolean }): BranchParItem => ({
  inventoryItemId: 9,
  name: 'Carprofen 100 mg',
  code: null,
  reorderPoint: 60,
  parLevel: null,
  quantityOnHand: 0,
  belowPar: true,
  ...over,
  quantityOnHandTotal: -60,
  locations: [
    { branchLocationId: 1, code: 'MAIN', name: 'Main', isDefault: true, quantityOnHand: -60, parLevel: 240, belowPar: true, notCounted: !over.mainCounted },
    { branchLocationId: 2, code: 'CAR', name: 'Car', isDefault: false, quantityOnHand: 0, parLevel: 30, belowPar: true, notCounted: !over.carCounted },
  ],
}) as BranchParItem;

describe('INV-A15: uncounted shelves stay off the lists', () => {
  it('suggests nothing while both shelves are uncounted', () => {
    const plan = planStockLists(4, 1, [item({ mainCounted: false, carCounted: false })], [], 'Office');
    expect(plan.requests).toEqual([]);
  });

  it('once the main shelf is counted it orders, but still asks nothing for the uncounted car', () => {
    const plan = planStockLists(4, 1, [item({ mainCounted: true, carCounted: false })], [], 'Office');
    expect(plan.requests.filter((r) => r.kind === 'order')).toHaveLength(1);
    expect(plan.requests.filter((r) => r.kind === 'fill')).toEqual([]);
  });

  it('a counted car short of par gets a fill', () => {
    const plan = planStockLists(4, 1, [item({ mainCounted: true, carCounted: true })], [], 'Office');
    expect(plan.requests.some((r) => r.branchLocationId === 2 || r.toBranchLocationId === 2)).toBe(true);
  });
});

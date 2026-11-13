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

/**
 * Option B (owner, Nov 9, 2026): a car shortfall that no transfer can cover is ordered for the office,
 * so a doctor's home office whose stock lives only in the car still gets an order when the car runs low.
 */
describe('a shortfall nothing can cover goes on the Order List', () => {
  const homeItem = (over: { carOnHand: number; main?: Partial<BranchParItem['locations'][number]>; min?: number | null }) =>
    ({
      inventoryItemId: 7,
      name: 'Doxycycline 100 mg tablet',
      code: null,
      reorderPoint: over.min ?? null,
      parLevel: null,
      quantityOnHand: over.carOnHand,
      belowPar: true,
      quantityOnHandTotal: over.carOnHand,
      locations: [
        { branchLocationId: 1, code: 'main', name: 'Home', isDefault: true, quantityOnHand: 0, parLevel: null, belowPar: false, notCounted: true, ...over.main },
        { branchLocationId: 2, code: 'CAR', name: 'Car', isDefault: false, quantityOnHand: over.carOnHand, parLevel: 100, belowPar: true, notCounted: false },
      ],
    }) as BranchParItem;

  it('orders the car shortfall when the home shelf has none and no min (never counted)', () => {
    const plan = planStockLists(5, 1, [homeItem({ carOnHand: 30 })], [], 'Dr. Shah home');
    const orders = plan.requests.filter((r) => r.kind === 'order');
    expect(orders).toEqual([{ kind: 'order', branchId: 5, branchLocationId: 1, inventoryItemId: 7, quantity: 70 }]);
    // The car still shows on the Transfer List with no From until the order arrives.
    expect(plan.requests.filter((r) => r.kind === 'fill')).toEqual([
      { kind: 'fill', branchId: 5, branchLocationId: 2, inventoryItemId: 7, quantity: 70 },
    ]);
    const b = plan.orderBreakdowns[0];
    expect(b).toMatchObject({ quantity: 70, mainOrder: 0, notCovered: 70, mainNotCounted: true });
    expect(b.locationNeeds).toEqual([expect.objectContaining({ locationName: 'Car', short: 70, notCovered: 70 })]);
  });

  it('orders nothing while the car is at par', () => {
    const plan = planStockLists(5, 1, [homeItem({ carOnHand: 100 })], [], 'Dr. Shah home');
    expect(plan.requests).toEqual([]);
  });

  it("another office's spare covers it first, so nothing is ordered", () => {
    const plan = planStockLists(5, 1, [homeItem({ carOnHand: 30 })], [
      { inventoryItemId: 7, branchId: 9, branchName: 'Raleigh office', branchLocationId: 90, locationName: 'Main', quantityOnHand: 500, parLevel: 200 },
    ]);
    expect(plan.requests.filter((r) => r.kind === 'order')).toEqual([]);
    expect(plan.requests.filter((r) => r.kind === 'transfer')).toEqual([
      expect.objectContaining({ branchId: 9, branchLocationId: 90, toBranchLocationId: 2, quantity: 70 }),
    ]);
  });

  it("adds what's not covered to Main's own order", () => {
    // Main counted: 20 on hand, min 20, max 50. The car needs 70: Main gives its 20, 50 isn't covered.
    const plan = planStockLists(5, 1, [homeItem({ carOnHand: 30, min: 20, main: { quantityOnHand: 20, parLevel: 50, notCounted: false } })], []);
    const b = plan.orderBreakdowns[0];
    expect(b).toMatchObject({ mainOut: 20, effectiveOnHand: 0, mainOrder: 50, notCovered: 50, quantity: 100, mainNotCounted: false });
  });

  it('an uncounted car still asks for nothing', () => {
    const item = homeItem({ carOnHand: 0 });
    item.locations[1].notCounted = true;
    expect(planStockLists(5, 1, [item], []).requests).toEqual([]);
  });
});

/** Owner request (Oct 30, 2026): the price list shows client prices, and where they differ. */
import { applyBranchOverride, clientUnitPrice, priceVariants } from './catalogPriceList';

const base = { price: 20, cost: 8, serviceFee: 15, minimumPrice: 0 };

it('prices one unit like checkout: fee added for inventory and procedures, not labs', () => {
  expect(clientUnitPrice('inventory', base)).toBe(35);
  expect(clientUnitPrice('procedure', base)).toBe(35);
  expect(clientUnitPrice('lab', base)).toBe(20);
  expect(clientUnitPrice('inventory', { ...base, minimumPrice: 50 })).toBe(50);
});

it('applies a branch override the way the API does (markup follows cost)', () => {
  expect(applyBranchOverride(base, { price: 25 })).toMatchObject({ price: 25, serviceFee: 15 });
  expect(applyBranchOverride(base, { markup: 250 })).toMatchObject({ price: 20 });
  expect(applyBranchOverride(base, { cost: 10, markup: 300 })).toMatchObject({ price: 30 });
  expect(applyBranchOverride(base, null)).toEqual(base);
});

it('lists only the branches and online store price that differ', () => {
  const variants = priceVariants({
    itemType: 'inventory',
    base,
    onlineStorePrice: 31.5,
    branchOverrides: [
      { branchName: 'HC home', override: { price: 25 } },
      { branchName: 'Main', override: { serviceFee: 15 } },
    ],
  });
  expect(variants).toEqual([
    { label: 'HC home', price: 40 },
    { label: 'Online store', price: 31.5 },
  ]);
  expect(priceVariants({ itemType: 'inventory', base, onlineStorePrice: 35, branchOverrides: [] })).toEqual([]);
});

/** Owner decisions (Oct 30, 2026): a controlled drug's lot comes from the doctor's safe. */
import { lineDrawsStock, lotShelf } from './lotShelf';

const invoice = { inventoryBranchId: 1, inventoryLocationId: 3 };
const safe = { branchId: 119, locationId: 252, name: 'HC home → Main' };

it('a controlled line uses the doctor’s controlled drug location', () => {
  expect(lotShelf({ catalogIsControlled: true, controlledLocation: safe }, invoice)).toEqual({
    branchId: 119,
    locationId: 252,
    safeName: 'HC home → Main',
  });
});

it('everything else, or a doctor with none set, uses the invoice’s shelf', () => {
  expect(lotShelf({ catalogIsControlled: false, controlledLocation: safe }, invoice)).toEqual({
    branchId: 1,
    locationId: 3,
    safeName: null,
  });
  expect(lotShelf({ catalogIsControlled: true, controlledLocation: null }, invoice)).toMatchObject({
    locationId: 3,
  });
  expect(lotShelf({}, null)).toEqual({ branchId: null, locationId: null, safeName: null });
});

describe('lineDrawsStock', () => {
  it('services and labs with no linked stock need no shelf', () => {
    expect(lineDrawsStock({ catalogItemType: 'procedure' })).toBe(false);
    expect(lineDrawsStock({ catalogItemType: 'lab' })).toBe(false);
  });
  it('stock items, linked stock, lot-tracked, vaccines and prescriptions do', () => {
    expect(lineDrawsStock({ catalogItemType: 'inventory' })).toBe(true);
    expect(lineDrawsStock({ catalogItemType: 'lab', stockInventoryItemId: 7 })).toBe(true);
    expect(lineDrawsStock({ trackLots: true })).toBe(true);
    expect(lineDrawsStock({ catalogIsVaccine: true })).toBe(true);
    expect(lineDrawsStock({ catalogItemType: 'procedure', instructions: 'Give 1 tab' })).toBe(true);
  });
  it('a removed line never does', () => {
    expect(lineDrawsStock({ catalogItemType: 'inventory', isDeleted: true })).toBe(false);
  });
});

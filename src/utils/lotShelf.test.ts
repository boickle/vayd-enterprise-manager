/** Owner decisions (Oct 30, 2026): a controlled drug's lot comes from the doctor's safe. */
import { lotShelf } from './lotShelf';

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
  expect(lotShelf({ catalogIsControlled: true, controlledLocation: null }, invoice)).toMatchObject({ locationId: 3 });
  expect(lotShelf({}, null)).toEqual({ branchId: null, locationId: null, safeName: null });
});

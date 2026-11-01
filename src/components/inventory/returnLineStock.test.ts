/** CAT-11: lot pre-fill and the checks on a returned line's stock choices. */
import { describe, expect, it } from 'vitest';
import {
  chosenReturnLots,
  prefillReturnLots,
  returnLotsProblem,
  returnStockRequestParts,
  returnWasteProblem,
  type ReturnLotOption,
} from './returnLineStock';

const lots = (a: number, b: number): ReturnLotOption[] => [
  { inventoryLotBalanceId: 1, lotNumber: 'A', expirationDate: null, standing: a },
  { inventoryLotBalanceId: 2, lotNumber: 'B', expirationDate: null, standing: b },
];
const reasons = [
  { code: 'broken', label: 'Broken', requiresDisposalMethod: 'no' },
  { code: 'returned_unsellable', label: 'Returned, not resellable', requiresDisposalMethod: 'optional' },
];

describe('prefillReturnLots', () => {
  it('puts the whole return on the last lot used when it still has enough', () => {
    expect(prefillReturnLots(lots(12, 8), 5)).toEqual({ 2: 5 });
  });
  it('caps at what is still standing for the last lot and moves the rest to the one before', () => {
    expect(prefillReturnLots(lots(12, 8), 10)).toEqual({ 2: 8, 1: 2 });
    expect(prefillReturnLots(lots(12, 3), 5)).toEqual({ 2: 3, 1: 2 });
  });
  it('skips a last lot with nothing standing', () => {
    expect(prefillReturnLots(lots(12, 0), 5)).toEqual({ 1: 5 });
  });
});

describe('returnLotsProblem', () => {
  it('accepts a split that adds up and fits', () => {
    expect(returnLotsProblem({ 1: 3, 2: 2 }, lots(12, 8), 5)).toBeNull();
  });
  it('says when the lots do not add up to the returned quantity', () => {
    expect(returnLotsProblem({ 1: 3, 2: 1 }, lots(12, 8), 5)).toBe(
      'The lots add up to 4 but you are returning 5. Make them match.'
    );
  });
  it('says when a lot is asked for more than is standing', () => {
    expect(returnLotsProblem({ 2: 9 }, lots(12, 8), 9)).toBe('Lot B has only 8 left to take back; you chose 9.');
  });
  it('uses the staff split only for the quantity it was made for', () => {
    const detail = { lotQty: { 1: '3', 2: '2' }, lotQtyFor: 5 };
    expect(chosenReturnLots(detail, lots(12, 8), 5)).toEqual({ 1: 3, 2: 2 });
    expect(chosenReturnLots(detail, lots(12, 8), 6)).toEqual({ 2: 6 });
  });
});

describe('returnWasteProblem', () => {
  it('needs a disposal method for a controlled drug, not for an ordinary item', () => {
    expect(returnWasteProblem({ isControlled: true, reasons, detail: {} })).toMatch(/required for controlled drugs/);
    expect(returnWasteProblem({ isControlled: true, reasons, detail: { disposalCode: 'sharps' } })).toBeNull();
    expect(returnWasteProblem({ isControlled: false, reasons, detail: {} })).toBeNull();
  });
  it('defaults the reason to "Returned, not resellable"', () => {
    const parts = returnStockRequestParts({
      backOnShelf: false, isControlled: false, options: undefined, detail: { notes: ' opened ' }, qty: 2, reasons,
    });
    expect(parts.waste).toMatchObject({ reasonCode: 'returned_unsellable', notes: 'opened', disposalMethodCode: null });
    expect(parts.lots).toBeUndefined();
  });
});

describe('returnStockRequestParts', () => {
  it('sends the lots for a multi-lot line only, and a witness only for a controlled item', () => {
    const multi = returnStockRequestParts({
      backOnShelf: true, isControlled: false, options: { isControlled: false, lots: lots(12, 8) },
      detail: undefined, qty: 5, reasons,
    });
    expect(multi.lots).toEqual([{ inventoryLotBalanceId: 2, quantity: 5 }]);
    expect(multi.waste).toBeUndefined();
    const single = returnStockRequestParts({
      backOnShelf: true, isControlled: false, options: { isControlled: false, lots: lots(12, 8).slice(0, 1) },
      detail: undefined, qty: 5, reasons,
    });
    expect(single.lots).toBeUndefined();
    const witnessed = returnStockRequestParts({
      backOnShelf: false, isControlled: true, options: { isControlled: true, lots: [] },
      detail: { disposalCode: 'sharps', witnessId: 9 }, qty: 1, reasons,
    });
    expect(witnessed.waste).toMatchObject({ disposalMethodCode: 'sharps', witnessEmployeeId: 9 });
  });
});

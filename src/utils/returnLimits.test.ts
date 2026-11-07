import { describe, expect, it } from 'vitest';
import { clampReturnQty, returnQtyProblem, returnableQty } from './returnLimits';

describe('W8A-2 return limits', () => {
  it('2 sold, 1 already returned: 1 can come back', () => {
    expect(returnableQty({ qty: 2 }, { returnedQty: 1 })).toBe(1);
  });
  it('nothing returned yet: all of it', () => {
    expect(returnableQty({ qty: 2 }, undefined)).toBe(2);
  });
  it('the refund estimate never counts more than is left', () => {
    expect(clampReturnQty('2', 1)).toBe(1);
    expect(clampReturnQty('', 1)).toBe(0);
  });
  it('typing 2 when 1 is left explains why', () => {
    expect(returnQtyProblem('Prescription diet bag', '2', { qty: 2 }, { returnedQty: 1 })).toBe(
      'Prescription diet bag: 1 already returned, so at most 1 can come back.'
    );
    expect(returnQtyProblem('Prescription diet bag', '1', { qty: 2 }, { returnedQty: 1 })).toBeNull();
  });
});

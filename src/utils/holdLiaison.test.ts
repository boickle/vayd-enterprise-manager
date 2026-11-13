/** B6 (Nov 13, 2026): the Hold tab's Liaison column shows the CL who placed the hold, like "Mine". */
import { describe, expect, it } from 'vitest';
import { holdLiaison } from './holdLiaison';

const casey = { id: 7, firstName: 'Casey', lastName: 'Morgan' };
const sam = { id: 8, firstName: 'Sam', lastName: 'Ortiz' };
const jordan = { id: 9, firstName: 'Jordan', lastName: 'Pike' };

describe('holdLiaison', () => {
  it('is the CL who placed the hold when nobody was assigned', () => {
    expect(
      holdLiaison({ holdOwner: null, createdByEmployee: casey, effectiveOwnerEmployeeId: 7 })
    ).toEqual(casey);
  });

  it('is nobody when a tech placed the hold (the API gives no effective owner)', () => {
    expect(
      holdLiaison({ holdOwner: null, createdByEmployee: jordan, effectiveOwnerEmployeeId: null })
    ).toBeNull();
  });

  it('is the assigned owner when there is one', () => {
    expect(
      holdLiaison({ holdOwner: sam, createdByEmployee: casey, effectiveOwnerEmployeeId: 8 })
    ).toEqual(sam);
  });
});

import type { HoldListItem } from '../api/holds';

/**
 * A hold's liaison: the assigned owner, or else the CL who placed it (the API's effective owner,
 * the same rule as "Mine"). A hold placed by a tech or doctor has none until a CL takes it
 * (B6; owner, Nov 13, 2026).
 */
export function holdLiaison(
  h: Pick<HoldListItem, 'holdOwner' | 'createdByEmployee' | 'effectiveOwnerEmployeeId'>
): HoldListItem['holdOwner'] {
  if (h.holdOwner) return h.holdOwner;
  if (
    h.effectiveOwnerEmployeeId != null &&
    h.createdByEmployee?.id === h.effectiveOwnerEmployeeId
  ) {
    return h.createdByEmployee;
  }
  return null;
}

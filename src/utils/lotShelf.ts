/**
 * Where a line's lot is picked from. A controlled drug comes from the charge's doctor's
 * controlled drug location (their safe); everything else from the invoice's office and shelf
 * (owner decisions, Oct 30, 2026).
 */
export function lotShelf(
  line: {
    catalogIsControlled?: boolean;
    controlledLocation?: { branchId: number; locationId: number; name: string } | null;
  },
  invoice: { inventoryBranchId?: number | null; inventoryLocationId?: number | null } | null | undefined
): { branchId: number | null; locationId: number | null; safeName: string | null } {
  if (line.catalogIsControlled && line.controlledLocation) {
    return {
      branchId: line.controlledLocation.branchId,
      locationId: line.controlledLocation.locationId,
      safeName: line.controlledLocation.name,
    };
  }
  return {
    branchId: invoice?.inventoryBranchId ?? null,
    locationId: invoice?.inventoryLocationId ?? null,
    safeName: null,
  };
}

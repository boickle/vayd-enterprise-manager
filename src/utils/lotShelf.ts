/**
 * Where a line's lot is picked from. A controlled drug comes from the charge's doctor's
 * controlled drug location (their safe); everything else from the invoice's office and shelf
 * (owner decisions, Oct 30, 2026).
 */
export function lotShelf(
  line: {
    inventoryBranchId?: number | null;
    inventoryLocationId?: number | null;
    catalogIsControlled?: boolean;
    controlledLocation?: { branchId: number; locationId: number; name: string } | null;
  },
  invoice:
    | { inventoryBranchId?: number | null; inventoryLocationId?: number | null }
    | null
    | undefined
): { branchId: number | null; locationId: number | null; safeName: string | null } {
  // A charge given its own shelf uses it (owner decision, Nov 2, 2026).
  if (line.inventoryBranchId != null && line.inventoryLocationId != null) {
    return {
      branchId: line.inventoryBranchId,
      locationId: line.inventoryLocationId,
      safeName: null,
    };
  }
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

/**
 * Whether a charge takes stock off a shelf when it's given in person, and so needs the
 * invoice's Branch/Location. Services, labs and other non-stock charges don't: the invoice's
 * branch for prices and tasks then falls back to the provider's office for the day (owner
 * decision, Nov 9, 2026). Callers leave out mail-order, shipping and tagalong lines.
 */
export function lineDrawsStock(line: {
  isDeleted?: boolean;
  catalogItemType?: string | null;
  stockInventoryItemId?: number | null;
  trackLots?: boolean;
  catalogIsVaccine?: boolean;
  catalogIsMedication?: boolean;
  catalogIsDispensable?: boolean;
  instructions?: string | null;
  refillCount?: number | null;
  rxApprovedAt?: string | null;
}): boolean {
  if (line.isDeleted) return false;
  return Boolean(
    line.catalogItemType === 'inventory' ||
    line.stockInventoryItemId != null ||
    line.trackLots ||
    line.catalogIsVaccine ||
    line.catalogIsMedication ||
    line.catalogIsDispensable ||
    line.instructions?.trim() ||
    line.refillCount != null ||
    line.rxApprovedAt
  );
}

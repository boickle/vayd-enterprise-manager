// src/api/branchInventory.ts — branches, locations, stock, movements, price overrides
import { http } from './http';

export type PracticeBranch = {
  id: number;
  practiceId: number;
  name: string;
  isDefault: boolean;
  isActive: boolean;
  pimsLocationId?: string | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  state?: string | null;
  zipcode?: string | null;
  country?: string | null;
  latitude?: number | null;
  longitude?: number | null;
};

export type PracticeBranchAddressBody = {
  address1: string;
  address2?: string | null;
  city: string;
  state: string;
  zipcode: string;
  country?: string | null;
  latitude?: number | null;
  longitude?: number | null;
};

export type BranchPriceOverrideEntityType = 'inventory_item' | 'procedure' | 'lab';

export type MoneyFields = {
  price: number | null;
  cost: number | null;
  serviceFee: number | null;
  minimumPrice: number | null;
};

export type BranchPriceOverride = {
  id: number;
  branchId?: number;
  entityType: BranchPriceOverrideEntityType;
  entityId: number;
  /** Percent of cost (175 = cost × 1.75); when set the branch price follows cost. */
  markup?: number | string | null;
  /** Left out of catalog search for visits at this branch. */
  hidden?: boolean;
} & MoneyFields;

/** Per-location quantity within the branch (from GET …/stock). */
export type InventoryStockLocationRow = {
  branchLocationId: number;
  code: string;
  name: string;
  isDefault?: boolean;
  quantityOnHand: number | null;
  parLevel?: number | null;
};

/** GET …/inventory-items/:id/stock — totals + per-bucket breakdown. */
export type InventoryBranchStock = {
  inventoryItemId: number;
  branchId: number;
  quantityOnHandTotal: number | null;
  reorderPoint: number | null;
  parLevel?: number | null;
  locations: InventoryStockLocationRow[];
};

export type BranchParLocation = {
  id: number;
  code: string;
  name: string;
  isDefault?: boolean;
};

export type BranchParItemLocation = {
  branchLocationId: number;
  code: string;
  name: string;
  isDefault?: boolean;
  quantityOnHand: number;
  parLevel: number | null;
  belowPar: boolean;
};

export type BranchParItem = {
  inventoryItemId: number;
  name: string;
  code: string | null;
  category?: number | null;
  categoryName?: string | null;
  reorderPoint: number | null;
  parLevel: number | null;
  quantityOnHandTotal: number;
  belowPar: boolean;
  locations: BranchParItemLocation[];
};

export type BranchParLevels = {
  branchId: number;
  locations: BranchParLocation[];
  items: BranchParItem[];
};

export type InventoryBranchLocation = {
  id: number;
  branchId: number;
  code: string;
  name: string;
  sortOrder?: number;
  isDefault?: boolean;
  isActive?: boolean;
};

export type InventoryMovementType =
  | 'transfer'
  | 'receive'
  | 'sold'
  | 'visit_use'
  | 'adjustment_increase'
  | 'adjustment_decrease'
  | 'expired'
  | 'opening_increase'
  | 'opening_decrease';

export type InventoryMovementParty = {
  id: number;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
};

export type PostInventoryMovementBody = {
  movementType: InventoryMovementType;
  inventoryItemId: number;
  quantity: number;
  fromBranchLocationId?: number | null;
  toBranchLocationId?: number | null;
  note?: string | null;
  /** Unbox / receiving metadata — persist on backend when supported (else echoed in audit only). */
  vendorName?: string | null;
  invoiceNumber?: string | null;
  lotNumber?: string | null;
  expirationDate?: string | null;
  unpackedAt?: string | null;
};

export type InventoryStockMovement = {
  id?: number;
  movementType?: InventoryMovementType;
  inventoryItemId?: number;
  quantity?: number;
  fromBranchLocationId?: number | null;
  toBranchLocationId?: number | null;
  note?: string | null;
  movedByUserId?: number | null;
  movedByEmployeeId?: number | null;
  movedByEmployee?: InventoryMovementParty | null;
  movedByUser?: InventoryMovementParty | null;
  inventoryItem?: { id: number; name: string } | null;
  branch?: { id: number; name: string } | null;
  fromBranchLocation?: { id: number; name: string } | null;
  toBranchLocation?: { id: number; name: string } | null;
  created?: string;
  fromQuantityBefore?: number | null;
  fromQuantityAfter?: number | null;
  toQuantityBefore?: number | null;
  toQuantityAfter?: number | null;
  [key: string]: unknown;
};

export async function listPracticeBranches(
  practiceId: number,
  opts?: { includeInactive?: boolean }
): Promise<PracticeBranch[]> {
  const { data } = await http.get<PracticeBranch[]>(`/practice/${practiceId}/branches`, {
    params: opts?.includeInactive ? { includeInactive: true } : undefined,
  });
  return Array.isArray(data) ? data : [];
}

/** Create an office/site branch. Default inventory location (`main`) is created server-side. */
export async function createPracticeBranch(
  practiceId: number,
  body: { name: string; pimsLocationId?: string | null } & PracticeBranchAddressBody
): Promise<PracticeBranch> {
  const { data } = await http.post<PracticeBranch>(`/practice/${practiceId}/branches`, body);
  return data;
}

/** Update name / address / PIMS id, or archive (`isActive: false`) / restore (`isActive: true`). */
export async function patchPracticeBranch(
  practiceId: number,
  branchId: number,
  body: {
    name?: string;
    pimsLocationId?: string | null;
    isActive?: boolean;
  } & Partial<PracticeBranchAddressBody>
): Promise<PracticeBranch> {
  const { data } = await http.patch<PracticeBranch>(
    `/practice/${practiceId}/branches/${branchId}`,
    body
  );
  return data;
}

export async function listInventoryBranchLocations(
  practiceId: number,
  branchId: number
): Promise<InventoryBranchLocation[]> {
  const { data } = await http.get<InventoryBranchLocation[]>(
    `/practice/${practiceId}/branches/${branchId}/inventory-locations`
  );
  return Array.isArray(data) ? data : [];
}

export async function createInventoryBranchLocation(
  practiceId: number,
  branchId: number,
  body: { code: string; name: string; sortOrder?: number }
): Promise<InventoryBranchLocation> {
  const { data } = await http.post<InventoryBranchLocation>(
    `/practice/${practiceId}/branches/${branchId}/inventory-locations`,
    body
  );
  return data;
}

export async function patchInventoryBranchLocation(
  practiceId: number,
  branchId: number,
  locationId: number,
  body: { name?: string; sortOrder?: number; isActive?: boolean }
): Promise<InventoryBranchLocation> {
  const { data } = await http.patch<InventoryBranchLocation>(
    `/practice/${practiceId}/branches/${branchId}/inventory-locations/${locationId}`,
    body
  );
  return data;
}

export async function getInventoryBranchStock(
  practiceId: number,
  branchId: number,
  inventoryItemId: number
): Promise<InventoryBranchStock> {
  const { data } = await http.get<InventoryBranchStock>(
    `/practice/${practiceId}/branches/${branchId}/inventory-items/${inventoryItemId}/stock`
  );
  return data;
}

/** Reorder / par; quantity changes use `postInventoryMovement`. */
export async function upsertInventoryBranchStock(
  practiceId: number,
  branchId: number,
  inventoryItemId: number,
  body: {
    reorderPoint?: number | null;
    parLevel?: number | null;
    locations?: { branchLocationId: number; parLevel?: number | null }[];
  }
): Promise<InventoryBranchStock> {
  const { data } = await http.put<InventoryBranchStock>(
    `/practice/${practiceId}/branches/${branchId}/inventory-items/${inventoryItemId}/stock`,
    body
  );
  return data;
}

export async function listBranchParLevels(
  practiceId: number,
  branchId: number
): Promise<BranchParLevels> {
  const { data } = await http.get<BranchParLevels>(
    `/practice/${practiceId}/branches/${branchId}/inventory-pars`
  );
  return data;
}

export async function postInventoryMovement(
  practiceId: number,
  branchId: number,
  body: PostInventoryMovementBody
): Promise<InventoryStockMovement> {
  const { data } = await http.post<InventoryStockMovement>(
    `/practice/${practiceId}/branches/${branchId}/inventory-movements`,
    body
  );
  return data;
}

export async function listInventoryMovements(
  practiceId: number,
  branchId: number,
  params?: {
    inventoryItemId?: number;
    branchLocationId?: number;
    fromDate?: string;
    toDate?: string;
    movedByUserId?: number;
    limit?: number;
    offset?: number;
  }
): Promise<{ total: number; rows: InventoryStockMovement[] }> {
  const { data } = await http.get<{ total: number; rows: InventoryStockMovement[] }>(
    `/practice/${practiceId}/branches/${branchId}/inventory-movements`,
    { params }
  );
  const total = typeof data?.total === 'number' ? data.total : 0;
  const rows = Array.isArray(data?.rows) ? data.rows : [];
  return { total, rows };
}

type InventoryItemHistoryBase = {
  id: string;
  at: string;
  branchId: number | null;
  branchName: string | null;
  who: string | null;
};

export type InventoryItemHistoryRow =
  | (InventoryItemHistoryBase & {
      kind: 'movement';
      movementType: string;
      quantity: number;
      fromLocation: string | null;
      toLocation: string | null;
      note: string | null;
      lotNumber: string | null;
    })
  | (InventoryItemHistoryBase & {
      kind: 'change';
      source: string;
      field: string;
      label: string;
      oldValue: string | null;
      newValue: string | null;
    });

export type InventoryItemHistoryKind = 'all' | 'movements' | 'changes';

export async function listInventoryItemHistory(
  practiceId: number,
  inventoryItemId: number,
  params: { kind?: InventoryItemHistoryKind; branchId?: number; limit?: number; offset?: number }
): Promise<{ total: number; rows: InventoryItemHistoryRow[] }> {
  const { data } = await http.get<{ total: number; rows: InventoryItemHistoryRow[] }>(
    `/practice/${practiceId}/inventory-items/${inventoryItemId}/history`,
    { params }
  );
  return {
    total: typeof data?.total === 'number' ? data.total : 0,
    rows: Array.isArray(data?.rows) ? data.rows : [],
  };
}

export async function listBranchPriceOverrides(
  practiceId: number,
  branchId: number,
  entityType?: BranchPriceOverrideEntityType
): Promise<BranchPriceOverride[]> {
  const { data } = await http.get<BranchPriceOverride[]>(
    `/practice/${practiceId}/branches/${branchId}/price-overrides`,
    {
      params: entityType ? { entityType } : undefined,
    }
  );
  return Array.isArray(data) ? data : [];
}

export async function upsertBranchPriceOverride(
  practiceId: number,
  branchId: number,
  body: {
    entityType: BranchPriceOverrideEntityType;
    entityId: number;
    price?: number | null;
    cost?: number | null;
    serviceFee?: number | null;
    minimumPrice?: number | null;
    markup?: number | null;
    hidden?: boolean;
  }
): Promise<BranchPriceOverride | null> {
  const { data } = await http.put<BranchPriceOverride>(
    `/practice/${practiceId}/branches/${branchId}/price-overrides`,
    body
  );
  return data;
}

export async function deleteBranchPriceOverride(
  practiceId: number,
  branchId: number,
  overrideId: number
): Promise<void> {
  await http.delete(`/practice/${practiceId}/branches/${branchId}/price-overrides/${overrideId}`);
}

export async function postEffectiveBranchPrice(
  practiceId: number,
  branchId: number,
  body: {
    entityType: BranchPriceOverrideEntityType;
    entityId: number;
    base: MoneyFields;
  }
): Promise<{ effective: MoneyFields; override?: BranchPriceOverride | null }> {
  const { data } = await http.post<{ effective: MoneyFields; override?: BranchPriceOverride | null }>(
    `/practice/${practiceId}/branches/${branchId}/price-overrides/effective`,
    body
  );
  return data;
}

export type EmployeeBranchAssignment = {
  branchId: number;
  isPrimary: boolean;
  defaultInventoryLocationId: number | null;
};

export async function getEmployeeBranches(
  practiceId: number,
  employeeId: number
): Promise<EmployeeBranchAssignment[]> {
  const { data } = await http.get<EmployeeBranchAssignment[]>(
    `/practice/${practiceId}/employees/${employeeId}/branches`
  );
  return Array.isArray(data) ? data : [];
}

export async function setEmployeeBranches(
  practiceId: number,
  employeeId: number,
  body: {
    branchIds: number[];
    primaryBranchId?: number;
    defaultInventoryLocationId?: number | null;
    /** Every office, none primary — managers, admins, CSRs. */
    practiceWide?: boolean;
  }
): Promise<void> {
  await http.put(`/practice/${practiceId}/employees/${employeeId}/branches`, body);
}

/** Lot / serial balance at a branch location. */
export type InventoryLotBalance = {
  id: number;
  inventoryItemId: number;
  branchId: number;
  branchName: string | null;
  branchLocationId: number;
  locationCode: string | null;
  locationName: string | null;
  lotNumber: string;
  serialNumber: string | null;
  expirationDate: string | null;
  quantityOnHand: number;
  /** One empty bottle from this lot, for counts by weight. */
  emptyBottleWeightGrams?: number | null;
};

/**
 * A lot's empty-bottle weight, from a sealed bottle's weight (and its mL) or set
 * directly. Weights are in the item's weight unit. Applies to the lot everywhere.
 */
export async function setLotBottleWeight(
  practiceId: number,
  lotId: number,
  body: {
    fullBottleWeight?: number | null;
    bottleMl?: number | null;
    emptyBottleWeight?: number | null;
  }
): Promise<{ lotId: number; emptyBottleWeightGrams: number | null }> {
  const { data } = await http.patch<{ lotId: number; emptyBottleWeightGrams: number | null }>(
    `/practice/${practiceId}/inventory-lots/${lotId}/bottle-weight`,
    body
  );
  return data;
}

export async function listInventoryLots(
  practiceId: number,
  inventoryItemId: number,
  opts?: { branchId?: number; locationId?: number; includeZero?: boolean }
): Promise<InventoryLotBalance[]> {
  const { data } = await http.get<InventoryLotBalance[]>(
    `/practice/${practiceId}/inventory-items/${inventoryItemId}/lots`,
    {
      params: {
        ...(opts?.branchId != null ? { branchId: opts.branchId } : {}),
        ...(opts?.locationId != null ? { locationId: opts.locationId } : {}),
        ...(opts?.includeZero ? { includeZero: '1' } : {}),
      },
    }
  );
  return Array.isArray(data) ? data : [];
}

export type ExpiringLotLocation = {
  lotId: number;
  branchId: number;
  branchName: string | null;
  branchLocationId: number;
  locationName: string | null;
  locationCode: string | null;
  lotNumber: string;
  serialNumber: string | null;
  expirationDate: string;
  quantityOnHand: number;
};

export type ExpiringLotItem = {
  inventoryItemId: number;
  name: string | null;
  code: string | null;
  soonestExpiration: string;
  totalQty: number;
  locations: ExpiringLotLocation[];
};

export type ExpiringLotsResponse = {
  withinDays: number;
  fromDate: string;
  toDate: string;
  rows: ExpiringLotItem[];
};

export async function listExpiringInventoryLots(
  practiceId: number,
  opts?: {
    withinDays?: number;
    branchId?: number;
    locationId?: number;
    includeZero?: boolean;
  }
): Promise<ExpiringLotsResponse> {
  const { data } = await http.get<ExpiringLotsResponse>(
    `/practice/${practiceId}/inventory-lots/expiring`,
    {
      params: {
        ...(opts?.withinDays != null ? { withinDays: opts.withinDays } : {}),
        ...(opts?.branchId != null ? { branchId: opts.branchId } : {}),
        ...(opts?.locationId != null ? { locationId: opts.locationId } : {}),
        ...(opts?.includeZero ? { includeZero: '1' } : {}),
      },
    }
  );
  return data;
}

export async function addInventoryLot(
  practiceId: number,
  body: {
    inventoryItemId: number;
    branchId: number;
    branchLocationId: number;
    lotNumber: string;
    serialNumber?: string | null;
    expirationDate?: string | null;
    quantityOnHand?: number;
    note?: string | null;
  }
): Promise<InventoryLotBalance> {
  const { data } = await http.post<InventoryLotBalance>(
    `/practice/${practiceId}/inventory-lots`,
    body
  );
  return data;
}

/** Setting quantityOnHand records an adjustment so branch counts move with the lot. */
export async function updateInventoryLot(
  practiceId: number,
  lotId: number,
  body: {
    lotNumber?: string;
    serialNumber?: string | null;
    expirationDate?: string | null;
    quantityOnHand?: number;
    isActive?: boolean;
    /** Audit note for quantity corrections (shown on Activity). */
    note?: string | null;
  }
): Promise<InventoryLotBalance> {
  const { data } = await http.patch<InventoryLotBalance>(
    `/practice/${practiceId}/inventory-lots/${lotId}`,
    body
  );
  return data;
}

export type FirstCountProgress = {
  totalItems: number;
  controlledItems: number;
  branches: Array<{
    branchId: number;
    branchName: string;
    locations: Array<{
      locationId: number;
      locationName: string;
      isDefault: boolean;
      countedItems: number;
      countedControlled: number;
      lastCountedAt: string | null;
    }>;
  }>;
};

export type FirstCountSheetItem = {
  inventoryItemId: number;
  code: string | null;
  name: string;
  categoryName: string | null;
  unit: string | null;
  isControlled: boolean;
  /** How staff count it: mL, by weighing the bottle, or both. */
  measure: 'volume' | 'weight' | 'both';
  weightUnit: 'g' | 'oz';
  trackLots: boolean;
  requireLotNumber: boolean;
  requireExpiration: boolean;
  firstCountedAt: string | null;
  firstCountedByName: string | null;
  /** Only once counted; the sheet is blind until then. */
  onHand: number | null;
  /** Most recent count of this item at the office (any count type). */
  lastCountedAt: string | null;
};

/** `first`: go-live opening balances. `annual`: recount; differences show in the Count report. */
export type CountUploadMode = 'first' | 'annual';

export type FirstCountSheet = {
  branchId: number;
  branchName: string;
  locationId: number;
  locationName: string;
  items: FirstCountSheetItem[];
};

export type FirstCountRow = {
  rowNumber?: number | null;
  inventoryItemId?: number | null;
  code?: string | null;
  name?: string | null;
  quantity?: number | string | null;
  /** Gross weight of the bottles on this row, in the item's weight unit. */
  weight?: number | string | null;
  bottles?: number | string | null;
  lotNumber?: string | null;
  expirationDate?: string | null;
  note?: string | null;
};

export type FirstCountResult = {
  dryRun: boolean;
  mode: CountUploadMode;
  countedAt: string;
  itemsCounted: number;
  controlledCounted: number;
  recounts: number;
  openingItems: number;
  itemsOff: number;
  blankRows: number;
  errors: Array<{ rowNumber: number | null; message: string }>;
  unmatched: Array<{
    rowNumber: number | null;
    code: string | null;
    name: string | null;
    quantity: number | null;
    lotNumber: string | null;
    expirationDate: string | null;
    note: string | null;
    reason: string;
  }>;
  items: Array<{
    inventoryItemId: number;
    code: string | null;
    name: string;
    unit: string | null;
    isControlled: boolean;
    alreadyCounted: boolean;
    /** Booked as an opening balance rather than an adjustment. */
    opening: boolean;
    counted: number;
    /** What Scout expected on the shelf at the time of the count. */
    expectedAtCount: number;
    currentInScout: number;
    changedSinceCount: number;
    change: number;
    afterApply: number;
    lots: Array<{ lotNumber: string | null; expirationDate: string | null; quantity: number }>;
    warnings: string[];
    /** e.g. "Lot K12: 118 g (2 bottles) = 52.73 mL" */
    weighings?: string[];
  }>;
};

/** "Existing stock (no lot recorded)" at a shelf that hasn't had its first count yet. */
export async function getUncountedShelfLot(
  practiceId: number,
  inventoryItemId: number,
  branchLocationId: number
): Promise<{
  id: number;
  lotNumber: string;
  expirationDate: string | null;
  quantityOnHand: number;
}> {
  const { data } = await http.post(
    `/practice/${practiceId}/inventory-items/${inventoryItemId}/uncounted-shelf-lot`,
    { branchLocationId }
  );
  return data;
}

export async function getFirstCountProgress(practiceId: number): Promise<FirstCountProgress> {
  const { data } = await http.get<FirstCountProgress>(
    `/practice/${practiceId}/inventory-first-counts/progress`
  );
  return data;
}

export async function getFirstCountSheet(
  practiceId: number,
  branchId: number,
  locationId: number
): Promise<FirstCountSheet> {
  const { data } = await http.get<FirstCountSheet>(
    `/practice/${practiceId}/branches/${branchId}/locations/${locationId}/first-count`
  );
  return data;
}

export async function submitFirstCount(
  practiceId: number,
  branchId: number,
  locationId: number,
  body: {
    rows: FirstCountRow[];
    countedAt?: string | null;
    dryRun: boolean;
    mode?: CountUploadMode;
  }
): Promise<FirstCountResult> {
  const { data } = await http.post<FirstCountResult>(
    `/practice/${practiceId}/branches/${branchId}/locations/${locationId}/first-count`,
    body
  );
  return data;
}

export type ParTargets = { par: number | null; min: number | null; max: number | null };

export type ParSeedSheetItem = ParTargets & {
  inventoryItemId: number;
  code: string | null;
  name: string;
  categoryName: string | null;
  unit: string | null;
  isControlled: boolean;
  onHand: number;
  /** Has had a first count at this location. */
  counted: boolean;
  usedHere: number;
  usedOffice: number;
};

export type ParSeedSheet = {
  branchId: number;
  branchName: string;
  locationId: number;
  locationName: string;
  isDefault: boolean;
  usageDays: number;
  items: ParSeedSheetItem[];
};

/** undefined = leave, null = clear, number = set. CSV text: blank = leave, "clear" = clear. */
export type ParSeedRow = {
  line?: number;
  inventoryItemId?: number | null;
  code?: string | null;
  name?: string | null;
  par?: number | string | null;
  min?: number | string | null;
  max?: number | string | null;
};

export type ParSeedResult = {
  dryRun: boolean;
  isDefault: boolean;
  rows: Array<{
    line: number;
    inventoryItemId: number | null;
    name: string;
    code: string | null;
    before: ParTargets | null;
    after: ParTargets | null;
    changed: boolean;
    error: string | null;
    warnings: string[];
  }>;
  summary: { changed: number; errors: number; unchanged: number };
};

/** An item that lost its stock item because that stock item was deleted in eVet. */
export type InventoryLinkRelease = {
  id: number;
  itemType: 'inventory' | 'procedure' | 'lab';
  itemId: number;
  itemName: string;
  formerStockItemId: number;
  formerStockItemName: string;
  releasedAt: string;
};

export async function listInventoryLinkReleases(
  practiceId: number
): Promise<InventoryLinkRelease[]> {
  const { data } = await http.get<InventoryLinkRelease[]>(
    `/practice/${practiceId}/inventory-link-releases`
  );
  return Array.isArray(data) ? data : [];
}

export async function keepInventoryLinkReleaseOnItself(
  practiceId: number,
  releaseId: number
): Promise<void> {
  await http.post(`/practice/${practiceId}/inventory-link-releases/${releaseId}/keep-on-itself`);
}

export async function getParSeedSheet(
  practiceId: number,
  branchId: number,
  locationId: number,
  days?: number
): Promise<ParSeedSheet> {
  const { data } = await http.get<ParSeedSheet>(
    `/practice/${practiceId}/branches/${branchId}/locations/${locationId}/par-seed`,
    { params: days ? { days } : undefined }
  );
  return data;
}

export type ParReviewSettings = {
  enabled: boolean;
  usageDays: number;
  parDays: number;
  minDays: number;
  maxDays: number;
  thresholdPct: number;
};

export type ParReviewItem = {
  inventoryItemId: number;
  code: string | null;
  name: string;
  categoryName: string | null;
  unit: string | null;
  isControlled: boolean;
  onHand: number;
  counted: boolean;
  used: number;
  current: ParTargets;
  suggested: ParTargets;
  notSet: boolean;
};

export type ParReview = {
  branchId: number;
  branchName: string;
  settings: ParReviewSettings;
  total: number;
  uncountedTotal: number;
  locations: Array<{
    locationId: number;
    locationName: string;
    isDefault: boolean;
    items: ParReviewItem[];
    uncounted: Array<{
      inventoryItemId: number;
      code: string | null;
      name: string;
      unit: string | null;
      isControlled: boolean;
      onHand: number;
      used: number;
    }>;
  }>;
};

/** Offices this person can approve par / min / max for. */
export async function getParApprovalOffices(practiceId: number): Promise<number[] | 'all'> {
  const { data } = await http.get<{ offices: number[] | 'all' }>(
    `/practice/${practiceId}/par-review/my-offices`
  );
  return data.offices;
}

export async function getParReview(practiceId: number, branchId: number): Promise<ParReview> {
  const { data } = await http.get<ParReview>(
    `/practice/${practiceId}/branches/${branchId}/par-review`
  );
  return data;
}

export async function keepParReview(
  practiceId: number,
  branchId: number,
  locationId: number,
  rows: Array<{ inventoryItemId: number; suggested: ParTargets }>
) {
  const { data } = await http.post<{ kept: number }>(
    `/practice/${practiceId}/branches/${branchId}/locations/${locationId}/par-review/keep`,
    { rows }
  );
  return data;
}

export async function getParReviewSettings(practiceId: number): Promise<ParReviewSettings> {
  const { data } = await http.get<ParReviewSettings>(`/practice/${practiceId}/par-review/settings`);
  return data;
}

export async function patchParReviewSettings(
  practiceId: number,
  body: Partial<ParReviewSettings>
): Promise<ParReviewSettings> {
  const { data } = await http.patch<ParReviewSettings>(
    `/practice/${practiceId}/par-review/settings`,
    body
  );
  return data;
}

export async function submitParSeed(
  practiceId: number,
  branchId: number,
  locationId: number,
  body: { rows: ParSeedRow[]; dryRun: boolean }
): Promise<ParSeedResult> {
  const { data } = await http.post<ParSeedResult>(
    `/practice/${practiceId}/branches/${branchId}/locations/${locationId}/par-seed`,
    body
  );
  return data;
}



// src/api/branchInventory.ts — branches, locations, stock, movements, price overrides
import { http } from './http';

export type PracticeBranch = {
  id: number;
  practiceId: number;
  name: string;
  isDefault: boolean;
  isActive: boolean;
  pimsLocationId?: string | null;
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
} & MoneyFields;

/** Per-location quantity within the branch (from GET …/stock). */
export type InventoryStockLocationRow = {
  branchLocationId: number;
  code: string;
  name: string;
  quantityOnHand: number | null;
};

/** GET …/inventory-items/:id/stock — totals + per-bucket breakdown; reorder only (no quantity on stock row). */
export type InventoryBranchStock = {
  inventoryItemId: number;
  branchId: number;
  quantityOnHandTotal: number | null;
  reorderPoint: number | null;
  locations: InventoryStockLocationRow[];
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
  | 'expired';

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
  body: { name: string; pimsLocationId?: string | null }
): Promise<PracticeBranch> {
  const { data } = await http.post<PracticeBranch>(`/practice/${practiceId}/branches`, body);
  return data;
}

/** Update name / PIMS id, or archive (`isActive: false`) / restore (`isActive: true`). */
export async function patchPracticeBranch(
  practiceId: number,
  branchId: number,
  body: { name?: string; pimsLocationId?: string | null; isActive?: boolean }
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

/** Reorder point only; quantity changes use `postInventoryMovement`. */
export async function upsertInventoryBranchStock(
  practiceId: number,
  branchId: number,
  inventoryItemId: number,
  body: { reorderPoint?: number | null }
): Promise<InventoryBranchStock> {
  const { data } = await http.put<InventoryBranchStock>(
    `/practice/${practiceId}/branches/${branchId}/inventory-items/${inventoryItemId}/stock`,
    body
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
  }
): Promise<BranchPriceOverride> {
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
): Promise<{ effective: MoneyFields }> {
  const { data } = await http.post<{ effective: MoneyFields }>(
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
};

export async function listInventoryLots(
  practiceId: number,
  inventoryItemId: number,
  opts?: { branchId?: number; includeZero?: boolean }
): Promise<InventoryLotBalance[]> {
  const { data } = await http.get<InventoryLotBalance[]>(
    `/practice/${practiceId}/inventory-items/${inventoryItemId}/lots`,
    {
      params: {
        ...(opts?.branchId != null ? { branchId: opts.branchId } : {}),
        ...(opts?.includeZero ? { includeZero: '1' } : {}),
      },
    }
  );
  return Array.isArray(data) ? data : [];
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
  }
): Promise<InventoryLotBalance> {
  const { data } = await http.patch<InventoryLotBalance>(
    `/practice/${practiceId}/inventory-lots/${lotId}`,
    body
  );
  return data;
}


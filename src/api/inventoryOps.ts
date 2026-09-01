import { http } from './http';

export type InventorySupplier = {
  id: number;
  practiceId: number;
  name: string;
  supplierType: string;
  isActive: boolean;
  roundOrdersToPackSize: boolean;
  defaultOrderFrequency: string;
  allowBackorders: boolean;
  website: string | null;
  repName: string | null;
  rep2Name: string | null;
  accountNumber: string | null;
  notes: string | null;
};

export type InventoryShipment = {
  id: number;
  practiceId: number;
  branchId: number;
  supplierId: number | null;
  invoiceNumber: string | null;
  status: 'draft' | 'finalized' | 'cancelled';
  defaultToBranchLocationId: number | null;
  receivedByEmployeeId: number | null;
  receivedByName: string | null;
  finalizedAt: string | null;
  note: string | null;
};

export type InventoryShipmentLine = {
  id: number;
  shipmentId: number;
  inventoryItemId: number;
  quantity: number | string;
  costPerUnit: number | string | null;
  lotNumber: string | null;
  expirationDate: string | null;
  toBranchLocationId: number;
  vendorSku: string | null;
  barcodeScanned: string | null;
  sortOrder: number;
  stockMovementId: number | null;
  itemName?: string | null;
};

export type WasteReason = {
  id: number;
  code: string;
  label: string;
  requiresDisposalMethod: string;
  sortOrder: number;
  isActive: boolean;
};

export type DisposalMethod = {
  id: number;
  code: string;
  label: string;
  sortOrder: number;
  isActive: boolean;
};

export type WasteConfig = {
  id: number;
  practiceId: number;
  alertSingleWasteUsd: number | string;
  alertMonthlyWasteUsd: number | string;
  alertFrequentLosses: boolean;
  managerNotification: boolean;
  requireDisposalForPrescription: boolean;
  requireDisposalForVaccine: boolean;
  requireDisposalForRefrigerated: boolean;
  requireNotesForReasons: string | null;
};

export async function listSuppliers(practiceId: number) {
  const { data } = await http.get<InventorySupplier[]>(
    `/practice/${practiceId}/inventory-suppliers`
  );
  return Array.isArray(data) ? data : [];
}

export async function createSupplier(
  practiceId: number,
  body: Partial<InventorySupplier> & { name: string }
) {
  const { data } = await http.post<InventorySupplier>(
    `/practice/${practiceId}/inventory-suppliers`,
    body
  );
  return data;
}

export async function updateSupplier(
  practiceId: number,
  supplierId: number,
  body: Partial<InventorySupplier> & { name: string }
) {
  const { data } = await http.patch<InventorySupplier>(
    `/practice/${practiceId}/inventory-suppliers/${supplierId}`,
    body
  );
  return data;
}

export async function lookupInventoryByCode(
  practiceId: number,
  code: string,
  supplierId?: number | null
) {
  const { data } = await http.get<{
    /** Already resolved to the item that holds stock. */
    item: { id: number; name: string; trackLots?: boolean; requireExpirationOnLots?: boolean; cost?: string | number | null };
    matchedVia: string;
    /** The sellable code scanned, when it draws stock from `item`. */
    resolvedFrom: { id: number; name: string } | null;
  } | null>(`/practice/${practiceId}/inventory-items/by-code`, {
    params: { code, ...(supplierId != null ? { supplierId } : {}) },
  });
  return data;
}

export async function createItemFromReceive(
  practiceId: number,
  body: { name: string; barcode?: string | null; category?: number | null }
) {
  const { data } = await http.post<{ id: number; name: string }>(
    `/practice/${practiceId}/inventory-ops/create-item`,
    body
  );
  return data;
}

export async function createShipment(
  practiceId: number,
  body: {
    branchId: number;
    supplierId?: number | null;
    invoiceNumber?: string | null;
    defaultToBranchLocationId?: number | null;
    note?: string | null;
  }
) {
  const { data } = await http.post<InventoryShipment>(
    `/practice/${practiceId}/inventory-shipments`,
    body
  );
  return data;
}

export async function getShipment(practiceId: number, shipmentId: number) {
  const { data } = await http.get<{
    shipment: InventoryShipment;
    lines: InventoryShipmentLine[];
  }>(`/practice/${practiceId}/inventory-shipments/${shipmentId}`);
  return data;
}

export async function listShipments(practiceId: number, status?: string) {
  const { data } = await http.get<InventoryShipment[]>(
    `/practice/${practiceId}/inventory-shipments`,
    { params: status ? { status } : undefined }
  );
  return Array.isArray(data) ? data : [];
}

export async function patchShipment(
  practiceId: number,
  shipmentId: number,
  body: Record<string, unknown>
) {
  const { data } = await http.patch<InventoryShipment>(
    `/practice/${practiceId}/inventory-shipments/${shipmentId}`,
    body
  );
  return data;
}

export async function addShipmentLine(
  practiceId: number,
  shipmentId: number,
  body: Record<string, unknown>
) {
  const { data } = await http.post<InventoryShipmentLine>(
    `/practice/${practiceId}/inventory-shipments/${shipmentId}/lines`,
    body
  );
  return data;
}

export async function removeShipmentLine(
  practiceId: number,
  shipmentId: number,
  lineId: number
) {
  const { data } = await http.delete(
    `/practice/${practiceId}/inventory-shipments/${shipmentId}/lines/${lineId}`
  );
  return data;
}

export async function finalizeShipment(
  practiceId: number,
  shipmentId: number
) {
  const { data } = await http.post(
    `/practice/${practiceId}/inventory-shipments/${shipmentId}/finalize`,
    {}
  );
  return data;
}

export async function cancelShipment(practiceId: number, shipmentId: number) {
  const { data } = await http.post(
    `/practice/${practiceId}/inventory-shipments/${shipmentId}/cancel`
  );
  return data;
}

export async function transferBatch(
  practiceId: number,
  branchId: number,
  body: {
    fromBranchLocationId: number;
    toBranchLocationId: number;
    lines: { inventoryItemId: number; quantity: number; lotNumber?: string | null }[];
    note?: string | null;
  }
) {
  const { data } = await http.post(
    `/practice/${practiceId}/branches/${branchId}/inventory-transfers/batch`,
    body
  );
  return data;
}

export async function getWasteAdmin(practiceId: number) {
  const { data } = await http.get<{
    config: WasteConfig;
    reasons: WasteReason[];
    methods: DisposalMethod[];
  }>(`/practice/${practiceId}/inventory-waste/admin`);
  return data;
}

export async function patchWasteConfig(
  practiceId: number,
  body: Partial<WasteConfig>
) {
  const { data } = await http.patch(
    `/practice/${practiceId}/inventory-waste/config`,
    body
  );
  return data;
}

export async function upsertWasteReason(
  practiceId: number,
  body: Partial<WasteReason> & { code: string; label: string }
) {
  const { data } = await http.post(
    `/practice/${practiceId}/inventory-waste/reasons`,
    body
  );
  return data;
}

export async function upsertDisposalMethod(
  practiceId: number,
  body: Partial<DisposalMethod> & { code: string; label: string }
) {
  const { data } = await http.post(
    `/practice/${practiceId}/inventory-waste/disposal-methods`,
    body
  );
  return data;
}

export async function recordWaste(
  practiceId: number,
  body: {
    branchId: number;
    inventoryItemId: number;
    fromBranchLocationId: number;
    quantity: number;
    reasonCode: string;
    disposalMethodCode?: string | null;
    notes?: string | null;
    lotNumber?: string | null;
  }
) {
  const { data } = await http.post(
    `/practice/${practiceId}/inventory-waste/events`,
    body
  );
  return data;
}

export type InventoryCostReview = {
  id: number;
  practiceId: number;
  branchId: number;
  branchName: string | null;
  inventoryItemId: number;
  itemName: string | null;
  itemCode: string | null;
  shipmentId: number;
  invoiceNumber: string | null;
  shipmentLineId: number;
  supplierId: number | null;
  quantity: number;
  previousCost: number | null;
  previousPrice: number | null;
  receivedCostPerUnit: number;
  suggestedPrice: number | null;
  costDelta: number | null;
  costDeltaPct: number | null;
  status: 'pending' | 'applied_catalog' | 'applied_branch' | 'dismissed';
  resolutionNote: string | null;
  resolvedAt: string | null;
  resolvedByUserId: number | null;
  resolvedByEmployeeId: number | null;
  created: string;
};

export async function listCostReviews(
  practiceId: number,
  opts?: { branchId?: number; status?: string }
) {
  const { data } = await http.get<InventoryCostReview[]>(
    `/practice/${practiceId}/inventory-cost-reviews`,
    {
      params: {
        branchId: opts?.branchId,
        status: opts?.status ?? 'pending',
      },
    }
  );
  return data;
}

export async function resolveCostReview(
  practiceId: number,
  reviewId: number,
  body: {
    action: 'apply_catalog' | 'apply_branch' | 'dismiss';
    note?: string | null;
  }
) {
  const { data } = await http.post<InventoryCostReview>(
    `/practice/${practiceId}/inventory-cost-reviews/${reviewId}/resolve`,
    body
  );
  return data;
}

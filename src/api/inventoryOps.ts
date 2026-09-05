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
  status: 'draft' | 'finalized' | 'cancelled' | 'deleted';
  defaultToBranchLocationId: number | null;
  receivedByEmployeeId: number | null;
  receivedByName: string | null;
  finalizedAt: string | null;
  deletedByEmployeeId?: number | null;
  deletedByName?: string | null;
  deletedAt?: string | null;
  note: string | null;
  invoicePdfKey?: string | null;
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
  catalogCost?: number | null;
  willUpdatePrice?: boolean;
  willQueueCostReview?: boolean;
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

export type ParsedInvoiceLine = {
  description: string;
  vendorSku: string | null;
  barcode: string | null;
  quantity: number | null;
  costPerUnit: number | null;
  lineTotal: number | null;
  lotNumber: string | null;
  expirationDate: string | null;
  status: 'matched' | 'ignored' | 'unmatched';
  inventoryItemId: number | null;
  inventoryItemName: string | null;
  matchVia: string | null;
  /** Stock units to receive (item sell unit), not vendor pack count. */
  receiveQuantity?: number | null;
  receiveUnitsPerVendorQty?: number | null;
  sellUnitType?: string | null;
  sellUnitTypeDetail?: string | null;
  unitsPerPackage?: number | null;
  trackLots?: boolean;
  requireExpirationOnLots?: boolean;
};

export type ParsedInvoice = {
  invoiceNumber: string | null;
  invoiceDate: string | null;
  supplierName: string | null;
  shipToName: string | null;
  shipToAddress: string | null;
  suggestedSupplierId: number | null;
  suggestedBranchId: number | null;
  lines: ParsedInvoiceLine[];
};

export async function parseInventoryInvoice(
  practiceId: number,
  file: File,
  supplierId?: number | null
) {
  const form = new FormData();
  form.append('file', file);
  const { data } = await http.post<ParsedInvoice>(
    `/practice/${practiceId}/inventory-invoices/parse`,
    form,
    {
      headers: { 'Content-Type': 'multipart/form-data' },
      params: supplierId != null ? { supplierId } : undefined,
      timeout: 90_000,
    }
  );
  return data;
}

export async function upsertVendorItemMap(
  practiceId: number,
  body: {
    supplierId?: number | null;
    vendorSku?: string | null;
    vendorDescription?: string | null;
    barcode?: string | null;
    inventoryItemId?: number | null;
    ignored?: boolean;
    receiveUnitsPerVendorQty?: number | null;
  }
) {
  const { data } = await http.post<{ ignored: boolean; inventoryItemId?: number }>(
    `/practice/${practiceId}/inventory-vendor-maps`,
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

export async function uploadShipmentInvoice(
  practiceId: number,
  shipmentId: number,
  file: File
) {
  const form = new FormData();
  form.append('file', file);
  const { data } = await http.post<InventoryShipment>(
    `/practice/${practiceId}/inventory-shipments/${shipmentId}/invoice-file`,
    form,
    {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 90_000,
    }
  );
  return data;
}

export async function getShipmentInvoiceFile(
  practiceId: number,
  shipmentId: number
) {
  const { data } = await http.get<{
    url: string;
    fileName: string;
    invoicePdfKey: string;
  }>(`/practice/${practiceId}/inventory-shipments/${shipmentId}/invoice-file`);
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

export async function deleteReceivedShipment(practiceId: number, shipmentId: number) {
  const { data } = await http.post<{
    shipment: InventoryShipment;
    lines: InventoryShipmentLine[];
  }>(`/practice/${practiceId}/inventory-shipments/${shipmentId}/delete`);
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

export type InventoryStockRequestKind = 'fill' | 'order' | 'transfer';
export type InventoryStockRequestStatus = 'open' | 'done' | 'cancelled';

export type InventoryStockRequest = {
  id: number;
  practiceId: number;
  kind: InventoryStockRequestKind;
  status: InventoryStockRequestStatus;
  branchId: number;
  branchName: string | null;
  branchLocationId: number;
  locationName: string | null;
  toBranchId: number | null;
  toBranchName: string | null;
  toBranchLocationId: number | null;
  toLocationName: string | null;
  inventoryItemId: number;
  itemName: string | null;
  itemCode: string | null;
  quantity: number;
  requestedByEmployeeId: number | null;
  requestedByName: string | null;
  created: string;
  resolvedAt: string | null;
};

export async function listStockRequests(
  practiceId: number,
  opts?: {
    kind?: InventoryStockRequestKind;
    status?: InventoryStockRequestStatus | 'all';
    branchId?: number;
    branchLocationId?: number;
  }
) {
  const { data } = await http.get<InventoryStockRequest[]>(
    `/practice/${practiceId}/inventory-stock-requests`,
    {
      params: {
        kind: opts?.kind,
        status: opts?.status ?? 'open',
        branchId: opts?.branchId,
        branchLocationId: opts?.branchLocationId,
      },
    }
  );
  return Array.isArray(data) ? data : [];
}

export async function createStockRequest(
  practiceId: number,
  body: {
    kind: InventoryStockRequestKind;
    branchId: number;
    branchLocationId: number;
    inventoryItemId: number;
    quantity: number;
    toBranchId?: number;
    toBranchLocationId?: number;
    automatic?: boolean;
  }
) {
  const { data } = await http.post<InventoryStockRequest>(
    `/practice/${practiceId}/inventory-stock-requests`,
    body
  );
  return data;
}

export async function resolveStockRequest(
  practiceId: number,
  requestId: number,
  status: 'done' | 'cancelled'
) {
  const { data } = await http.post<InventoryStockRequest>(
    `/practice/${practiceId}/inventory-stock-requests/${requestId}/resolve`,
    { status }
  );
  return data;
}

export type InventoryPurchaseOrderLine = {
  id: number;
  inventoryItemId: number;
  itemName: string | null;
  itemCode: string | null;
  branchLocationId: number;
  locationName: string | null;
  quantity: number;
};

export type InventoryPurchaseOrder = {
  id: number;
  practiceId: number;
  branchId: number;
  branchName: string | null;
  supplierId: number;
  supplierName: string | null;
  status: 'open' | 'cancelled';
  orderedByEmployeeId: number | null;
  orderedByName: string | null;
  orderedAt: string;
  note: string | null;
  lines: InventoryPurchaseOrderLine[];
};

export async function listPurchaseOrders(practiceId: number, branchId?: number) {
  const { data } = await http.get<InventoryPurchaseOrder[]>(
    `/practice/${practiceId}/inventory-purchase-orders`,
    { params: branchId != null ? { branchId } : undefined }
  );
  return Array.isArray(data) ? data : [];
}

export async function createPurchaseOrder(
  practiceId: number,
  body: {
    branchId: number;
    supplierId: number;
    note?: string | null;
    orderedAt?: string | null;
    lines: { inventoryItemId: number; branchLocationId: number; quantity: number }[];
  }
) {
  const { data } = await http.post<InventoryPurchaseOrder>(
    `/practice/${practiceId}/inventory-purchase-orders`,
    body
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

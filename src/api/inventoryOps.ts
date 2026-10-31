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
  /** The login that finalized, when it has no employee link. */
  receivedByUserId?: number | null;
  finalizedAt: string | null;
  deletedByEmployeeId?: number | null;
  deletedByName?: string | null;
  deletedByUserId?: number | null;
  deletedAt?: string | null;
  note: string | null;
  invoicePdfKey?: string | null;
  invoiceShipTo?: string | null;
  shipToMismatch?: boolean;
  /** Audit note written when received at an office whose ship-to differs from the invoice. */
  shipToMismatchNote?: string | null;
};

export type ShipToStatus = 'match' | 'mismatch' | 'unknown';

export type InventoryShipmentLine = {
  id: number;
  shipmentId: number;
  inventoryItemId: number;
  quantity: number | string;
  costPerUnit: number | string | null;
  lotNumber: string | null;
  expirationDate: string | null;
  /** One sealed bottle, for controlled items counted by weight. */
  fullBottleWeightGrams?: number | string | null;
  toBranchLocationId: number;
  vendorSku: string | null;
  barcodeScanned: string | null;
  sortOrder: number;
  stockMovementId: number | null;
  isNewItem?: boolean;
  itemName?: string | null;
  catalogCost?: number | null;
  catalogPrice?: number | null;
  /** The sell price finalizing would set; only when `costAction` is `update`. */
  newPrice?: number | null;
  /** What finalizing does with this cost: update prices now, or hold it for a manager. */
  costAction?: 'none' | 'update' | 'review_lower' | 'review_large' | 'review_new';
  increasePct?: number | null;
  /** Largest increase (percent) that updates prices without a manager. */
  increaseLimitPct?: number;
  linkedProductCount?: number;
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
  inventoryLotBalanceId?: number | null;
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
  requireLotNumber?: boolean;
  /** Matched to an item created during this receive. */
  isNewItem?: boolean;
};

export type ParsedInvoice = {
  invoiceNumber: string | null;
  invoiceDate: string | null;
  supplierName: string | null;
  shipToName: string | null;
  shipToAddress: string | null;
  /** Ship-to name + address as one line, saved on the shipment. */
  invoiceShipTo?: string | null;
  shipToBranchId?: number | null;
  /** 'unknown' when the invoice ship-to can't be compared (missing or no ZIP). */
  shipToStatusByBranch?: Record<string, ShipToStatus>;
  suggestedSupplierId: number | null;
  suggestedBranchId: number | null;
  lines: ParsedInvoiceLine[];
};

/** One PDF, or one photo per page of the same invoice (sent together, read as one). */
export async function parseInventoryInvoice(
  practiceId: number,
  files: File | File[],
  supplierId?: number | null
) {
  const form = new FormData();
  const list = Array.isArray(files) ? files : [files];
  if (list.length === 1) form.append('file', list[0]);
  else for (const f of list) form.append('files', f);
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
    item: { id: number; name: string; trackLots?: boolean; requireExpirationOnLots?: boolean; requireLotNumber?: boolean; cost?: string | number | null };
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
  body: {
    name: string;
    barcode?: string | null;
    category?: number | null;
    cost?: number | null;
    price?: number | null;
    sellUnitType?: string | null;
    trackLots?: boolean;
  }
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
    invoiceShipTo?: string | null;
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
    shipTo: { invoiceShipTo: string | null; branchShipTo: string; status: ShipToStatus } | null;
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

export async function updateShipmentLine(
  practiceId: number,
  shipmentId: number,
  lineId: number,
  body: Record<string, unknown>
) {
  const { data } = await http.patch<InventoryShipmentLine>(
    `/practice/${practiceId}/inventory-shipments/${shipmentId}/lines/${lineId}`,
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
    lines: {
      inventoryItemId: number;
      quantity: number;
      lotNumber?: string | null;
      inventoryLotBalanceId?: number | null;
    }[];
    note?: string | null;
  }
) {
  const { data } = await http.post<{ id: number; negativeWarning?: string | null }[]>(
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
    inventoryLotBalanceId?: number | null;
    /** Invoice line the dose was drawn for; the controlled log then shows it under that charge. */
    invoiceLineId?: string | null;
    /** Required for "Other Correction" and for disposal "Other". */
    explanation?: string | null;
  }
) {
  const { data } = await http.post<{ id: number; negativeWarning?: string | null }>(
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
  /**
   * `new_item`: added while receiving, so cost and price need a first look.
   * `large_increase`: over the auto-apply limit. `new_cost`: no catalog cost to compare with.
   * Both of those leave prices unchanged until a manager applies them.
   */
  reason?: 'lower_cost' | 'new_item' | 'large_increase' | 'new_cost';
  resolutionNote: string | null;
  resolvedAt: string | null;
  resolvedByUserId: number | null;
  resolvedByEmployeeId: number | null;
  created: string;
  linkedItems?: InventoryCostReviewLinkedItem[];
};

export type InventoryCostReviewLinkedItem = {
  id: number;
  name: string;
  code: string | null;
  unitsPerSale: number;
  cost: number | null;
  price: number | null;
  nextCost: number;
  nextPrice: number | null;
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
  /** Order list only: the order in bottles, when the item has linked bottle sizes. */
  packs?: OrderPackPlan | null;
};

/** `count` bottles of `size` stock units; `replacesSold` of them replace bottles sold whole. */
export type OrderPackLine = { size: number; count: number; replacesSold: number };
export type OrderPackPlan = { packs: OrderPackLine[]; units: number };

/** "2 × 180-count + 1 × 30-count" */
export function formatOrderPacks(plan: OrderPackPlan): string {
  return plan.packs.map((p) => `${p.count} × ${p.size}-count`).join(' + ');
}

/** "2 of the 180s replace bottles sold" or null when none were sold whole. */
export function orderPacksSoldNote(plan: OrderPackPlan): string | null {
  const sold = plan.packs.filter((p) => p.replacesSold > 0);
  if (sold.length === 0) return null;
  const parts = sold.map((p) => `${p.replacesSold} × ${p.size}-count`);
  return `Replaces bottles sold since the last order: ${parts.join(', ')}`;
}

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
    appliedCost?: number | null;
    suggestedPrice?: number | null;
  }
) {
  const { data } = await http.post<InventoryCostReview>(
    `/practice/${practiceId}/inventory-cost-reviews/${reviewId}/resolve`,
    body
  );
  return data;
}

export type ControlledLineType = 'dispensed' | 'returned' | 'wasted' | 'adjusted';

export type ControlledReportTotals = {
  inventoryItemId: number;
  itemName: string;
  lotNumber: string;
  dispensedMl: number;
  returnedMl: number;
  wastedMl: number;
  adjustedMl: number;
  /** Set for items weighed in grams; null for volume-only items. */
  dispensedGrams: number | null;
};

export type ControlledReportLine = {
  movementId: number;
  at: string;
  type: ControlledLineType;
  inventoryItemId: number;
  itemName: string;
  lotNumber: string | null;
  quantityMl: number;
  grams: number | null;
  shelfName: string | null;
  patientId: number | null;
  patientName: string | null;
  clientId: number | null;
  clientName: string | null;
  /** Who entered the charge (or recorded the waste), like Vet Snap's "Log Created By". */
  loggedByName: string | null;
  invoiceNumber: string | null;
  invoiceId: string | null;
  wasteReason: string | null;
  /** Disposal method code for waste (e.g. reverse_distribution). */
  wasteDisposal?: string | null;
  /** The written why for "Other Correction" or an "Other" disposal. */
  wasteExplanation?: string | null;
  /** False when a dose came off a shelf other than the doctor's own. */
  fromHomeShelf: boolean;
  /** The item is a medication (sent home: dispensed); otherwise a dose given is administered. */
  isMedication?: boolean;
  /** Set once someone has matched this entry in Vet Snap. */
  reconciledAt?: string | null;
  reconciledByName?: string | null;
};

export type ControlledReportDoctor = {
  employeeId: number | null;
  name: string;
  /** False when the doctor has no home shelf set, so no dose can be flagged off-shelf. */
  hasHomeShelf?: boolean;
  totals: ControlledReportTotals[];
  lines: ControlledReportLine[];
};

export type ControlledReport = {
  fromDate: string;
  toDate: string;
  doctors: ControlledReportDoctor[];
};

/** Controlled drugs dispensed, returned and wasted under each doctor (INV-A14). */
export async function getControlledReport(practiceId: number, fromDate: string, toDate: string) {
  const { data } = await http.get<ControlledReport>(
    `/practice/${practiceId}/inventory-reports/controlled`,
    { params: { fromDate, toDate } }
  );
  return data;
}

/** Mark controlled-log entries as matched in Vet Snap, or undo it. */
export async function setControlledReconciled(
  practiceId: number,
  movementIds: number[],
  reconciled: boolean
) {
  const { data } = await http.post<{ updated: number }>(
    `/practice/${practiceId}/inventory-reports/controlled/reconciled`,
    { movementIds, reconciled }
  );
  return data;
}

export type VetSnapPatientRow = {
  patientId: number;
  patientName: string;
  species: string;
  breed: string;
  clientId: number | null;
  clientFirstName: string;
  clientLastName: string;
  clientAddress1: string;
  clientAddress2: string;
  clientCity: string;
  clientState: string;
  clientZipCode: string;
};

export type VetSnapPatientExport = {
  fromDate: string;
  toDate: string;
  rows: VetSnapPatientRow[];
};

/** Patients and clients given a controlled drug in the last 14 days, for the Vet Snap import. */
export async function getVetSnapPatientExport(practiceId: number) {
  const { data } = await http.get<VetSnapPatientExport>(
    `/practice/${practiceId}/inventory-reports/controlled/vet-snap-patients`
  );
  return data;
}

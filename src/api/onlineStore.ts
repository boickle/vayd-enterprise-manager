import axios from 'axios';
import { apiBaseUrl, http } from './http';

export function storeApiError(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as { message?: string | string[] } | string | undefined;
    if (typeof data === 'string' && data.trim()) return data;
    if (data && typeof data === 'object') {
      const msg = data.message;
      if (typeof msg === 'string' && msg.trim()) return msg;
      if (Array.isArray(msg) && msg.length) return msg.filter(Boolean).join(' ');
    }
  }
  return err instanceof Error ? err.message : 'Something went wrong';
}

export type EcwidMapMatch = {
  inventoryItemId: number;
  catalogItemType?: 'inventory' | 'procedure';
  name: string;
  code: string | null;
};

export type EcwidMapRow = {
  id: number;
  ecwidProductId: string;
  ecwidSku: string;
  ecwidName: string;
  ecwidImageUrl: string | null;
  ecwidCategory: string | null;
  inventoryItemId: number | null;
  matchedItemIds?: number[];
  matchedProcedureIds?: number[];
  variationHints?: string | null;
  confidence: 'exact' | 'name' | 'fuzzy' | 'manual' | 'none';
  status: 'suggested' | 'confirmed' | 'skipped';
  recommendedFrequency: string | null;
  matchName: string | null;
  matchCode: string | null;
  matches?: EcwidMapMatch[];
};

export type StoreItemRow = {
  inventoryItemId: number;
  name: string;
  code: string | null;
  onlineStorePrice: number | null;
  shippable: boolean;
  hasImage: boolean;
  approvalTag: 'approved' | 'needs_doctor_approval';
  listed: boolean;
  recommendedFrequency: string | null;
  featuredOnHome?: boolean;
  storeCategory: string | null;
  description: string | null;
  imagePath?: string | null;
};

export type StorePriceBreak = {
  lowQuantity: number;
  highQuantity: number;
  price: number;
};

export type StoreVariant = {
  inventoryItemId: number | null;
  procedureId?: number | null;
  catalogItemType?: 'inventory' | 'procedure';
  name: string;
  code: string | null;
  onlineStorePrice: number | null;
  priceBreaks?: StorePriceBreak[];
  strength: string | null;
  pack: string;
  hasImage?: boolean;
  optionLabel?: string | null;
  recommendedFrequency?: string | null;
  taxLevelValue?: number | null;
  approvalTag?: 'approved' | 'needs_doctor_approval';
};

export type StoreSaleType = 'amount' | 'percent';

export type StoreListing = {
  listingId: string;
  name: string;
  storeCategory: string | null;
  description: string | null;
  imageInventoryItemId: number | null;
  imageProductId?: number | null;
  storeProductId?: number;
  hasImage: boolean;
  approvalTag: 'approved' | 'needs_doctor_approval';
  recommendedFrequency: string | null;
  featuredOnHome?: boolean;
  listed?: boolean;
  priceFrom: number | null;
  priceFromWas?: number | null;
  saleType?: StoreSaleType | null;
  saleValue?: number | null;
  saleEndsAt?: string | null;
  saleLabel?: string | null;
  saleActive?: boolean;
  variants: StoreVariant[];
};

export type StoreAdminVariant = StoreVariant & {
  approvalTag: StoreItemRow['approvalTag'];
  listed: boolean;
  featuredOnHome: boolean;
  recommendedFrequency: string | null;
};

export type StoreAdminListing = Omit<StoreListing, 'variants'> & {
  listed: boolean;
  featuredOnHome: boolean;
  variants: StoreAdminVariant[];
};

export type MailApprovalNote = {
  at: string;
  kind:
    | 'task_sent'
    | 'approved'
    | 'rejected'
    | 'send_back'
    | 'note'
    | 'sig'
    | 'contacted'
    | 'thanks'
    | 'check_override';
  notes?: string | null;
  actorName?: string | null;
  assignedToName?: string | null;
};

export type MailOrderLine = {
  id: number;
  inventoryItemId: number | null;
  patientId?: number | null;
  patientName?: string | null;
  primaryProviderName?: string | null;
  weightLbs?: number | null;
  weightDate?: string | null;
  rxNumber?: number | null;
  name: string;
  strength: string | null;
  quantity: number;
  unitPrice: number;
  autoshipFrequency: string | null;
  renewalDate: string | null;
  lineStatus: 'ok_to_mail' | 'awaiting_doctor_approval' | 'rejected' | 'send_back';
  approvalDecision?: 'approved' | 'rejected' | 'send_back' | null;
  refillNote?: string | null;
  /** Refills the approving doctor wants the filler to put on this Rx. */
  authorizedRefills?: number | null;
  authorizedRefillExpiration?: string | null;
  refillsRemaining?: number | null;
  refillExpiresAt?: string | null;
  scriptText?: string | null;
  autoship?: boolean;
  kitKind: 'fecal' | 'urine' | null;
  inventoryLotBalanceId?: number | null;
  lotNumber?: string | null;
  stockInventoryItemId?: number | null;
  trackLots?: boolean;
};

export type MailPharmacyStage =
  | 'needs_approval'
  | 'needs_payment'
  | 'fill'
  | 'check'
  | 'rtg'
  | 'ship'
  | 'ready_for_pickup'
  | 'contacted'
  | 'done'
  | 'rejected';

export type MailProcessStatus =
  | 'queued'
  | 'filled'
  | 'first_check'
  | 'second_check'
  | 'packaged'
  | 'rtg'
  | 'shipped';

export type MailOrder = {
  id: number;
  origin: 'online_store' | 'staff_mail' | 'office_pickup' | 'kit';
  status: string;
  paymentStatus?: 'paid' | 'awaiting_payment';
  shippingPaymentStatus?: 'paid' | 'awaiting_payment';
  processStatus?: MailProcessStatus;
  approvalStatus?:
    | 'needs_doctor_approval'
    | 'approval_pending'
    | 'doctor_approved'
    | 'rejected'
    | 'send_back';
  pickup?: boolean;
  autoship?: boolean;
  pharmacyStage?: MailPharmacyStage;
  checkNotes?: string | null;
  approvalNotes?: MailApprovalNote[];
  patients?: Array<{
    id: number | null;
    name: string | null;
    primaryProviderName?: string | null;
    weightLbs?: number | null;
    weightDate?: string | null;
  }>;
  approvalTaskId?: number | null;
  fillerEmployeeId?: number | null;
  firstCheckerEmployeeId?: number | null;
  secondCheckerEmployeeId?: number | null;
  fillerName?: string | null;
  fillBranchId?: number | null;
  fillBranchName?: string | null;
  filledAt?: string | null;
  packagedAt?: string | null;
  secondCheckedAt?: string | null;
  clientContactedAt?: string | null;
  clientContactKind?: 'email' | 'sms' | 'none' | null;
  firstCheckerName?: string | null;
  secondCheckerName?: string | null;
  doctorEmployeeId?: number | null;
  doctorName?: string | null;
  createdByEmployeeId?: number | null;
  createdByName?: string | null;
  clientId?: number | null;
  patientId?: number | null;
  patientName?: string | null;
  customerName: string;
  customerEmail: string | null;
  shipName: string | null;
  shipLine1: string | null;
  shipLine2: string | null;
  shipCity: string | null;
  shipState: string | null;
  shipPostal: string | null;
  couponCode: string | null;
  subtotal: number;
  discount: number;
  shipping: number;
  total: number;
  freeShipping: boolean;
  shippingChargeName: string | null;
  labelUrl: string | null;
  trackingCode: string | null;
  carrier: string | null;
  service: string | null;
  easypostShipmentId?: string | null;
  labelRefundStatus?: string | null;
  packageWeightOz: number | null;
  packerEmployeeId: number | null;
  checkerEmployeeId: number | null;
  notes: string | null;
  lines: MailOrderLine[];
  created: string;
};

export type StoreCoupon = {
  id: number;
  code: string;
  name: string;
  discountType: 'percent' | 'amount';
  amount: number;
  membershipOnly: boolean;
  active: boolean;
  freeShipping: boolean;
};

export function storeProductImageUrl(
  practiceId: number,
  inventoryItemId: number,
): string {
  return `${apiBaseUrl}/practice/${practiceId}/inventory-items/${inventoryItemId}/image`;
}

export function storeMasterImageUrl(practiceId: number, productId: number): string {
  return `${apiBaseUrl}/public/store/products/${productId}/image?practiceId=${practiceId}`;
}

/** Variant inventory image if present, otherwise the master product image. */
export function storeListingImageUrl(
  practiceId: number,
  listing: Pick<
    StoreListing,
    'imageInventoryItemId' | 'imageProductId' | 'storeProductId' | 'hasImage'
  >,
  variant?: Pick<StoreVariant, 'inventoryItemId' | 'hasImage'> | null,
): string | null {
  if (variant?.hasImage && variant.inventoryItemId) {
    return storeProductImageUrl(practiceId, variant.inventoryItemId);
  }
  if (listing.imageProductId) {
    return storeMasterImageUrl(practiceId, listing.imageProductId);
  }
  if (listing.imageInventoryItemId) {
    return storeProductImageUrl(practiceId, listing.imageInventoryItemId);
  }
  return null;
}

export async function importEcwidCatalog(practiceId: number, file: File) {
  const form = new FormData();
  form.append('file', file);
  const { data } = await http.post<{
    masters: number;
    clonesExcluded: number;
    maps: EcwidMapRow[];
  }>(`/practice/${practiceId}/online-store/import`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}

export async function listEcwidMaps(practiceId: number) {
  const { data } = await http.get<EcwidMapRow[]>(
    `/practice/${practiceId}/online-store/maps`
  );
  return data ?? [];
}

export async function patchEcwidMap(
  practiceId: number,
  mapId: number,
  body: {
    inventoryItemId?: number | null;
    addInventoryItemId?: number;
    addProcedureId?: number;
    removeInventoryItemId?: number;
    removeProcedureId?: number;
    inventoryItemIds?: number[];
    procedureIds?: number[];
    status?: 'suggested' | 'confirmed' | 'skipped';
    excluded?: boolean;
  }
) {
  const { data } = await http.patch<EcwidMapRow>(
    `/practice/${practiceId}/online-store/maps/${mapId}`,
    body
  );
  return data;
}

export async function searchStoreInventory(practiceId: number, q: string) {
  const { data } = await http.get<
    Array<{
      id: number;
      name: string;
      code: string | null;
      catalogItemType?: 'inventory' | 'procedure';
      hasImage?: boolean;
    }>
  >(`/practice/${practiceId}/online-store/inventory-search`, {
    params: { q },
  });
  return data ?? [];
}

export async function confirmEcwidMaps(
  practiceId: number,
  mapIds: number[],
  downloadImages = true
) {
  const { data } = await http.post<{
    results: Array<{ id: number; name: string; ok: boolean; error?: string }>;
  }>(`/practice/${practiceId}/online-store/maps/confirm`, {
    mapIds,
    downloadImages,
  });
  return data;
}

export async function listOnlineStoreItems(practiceId: number) {
  const { data } = await http.get<StoreItemRow[]>(
    `/practice/${practiceId}/online-store/items`
  );
  return data ?? [];
}

export async function listOnlineStoreListings(practiceId: number) {
  const { data } = await http.get<StoreAdminListing[]>(
    `/practice/${practiceId}/online-store/listings`
  );
  return data ?? [];
}

export async function getCatalogStoreListing(
  practiceId: number,
  q: { inventoryItemId?: number; procedureId?: number }
) {
  const { data } = await http.get<StoreAdminListing | null>(
    `/practice/${practiceId}/online-store/catalog-listing`,
    { params: q }
  );
  return data ?? null;
}

export async function createOnlineStoreProduct(
  practiceId: number,
  body: {
    name?: string;
    description?: string | null;
    inventoryItemId?: number;
    procedureId?: number;
    approvalTag?: 'approved' | 'needs_doctor_approval';
    featuredOnHome?: boolean;
    storeCategory?: string | null;
    saleType?: StoreSaleType | null;
    saleValue?: number | null;
    saleEndsAt?: string | null;
    saleLabel?: string | null;
  }
) {
  const { data } = await http.post<StoreAdminListing>(
    `/practice/${practiceId}/online-store/products`,
    body
  );
  return data;
}

export async function addOnlineStoreVariant(
  practiceId: number,
  listingId: string,
  body: { inventoryItemId?: number | null; procedureId?: number | null }
) {
  const { data } = await http.post<StoreAdminListing>(
    `/practice/${practiceId}/online-store/listings/${encodeURIComponent(listingId)}/variants`,
    body
  );
  return data;
}

export async function removeOnlineStoreVariant(
  practiceId: number,
  listingId: string,
  body: { inventoryItemId?: number | null; procedureId?: number | null }
) {
  const { data } = await http.delete<StoreAdminListing | null>(
    `/practice/${practiceId}/online-store/listings/${encodeURIComponent(listingId)}/variants`,
    {
      params: {
        inventoryItemId: body.inventoryItemId || undefined,
        procedureId: body.procedureId || undefined,
      },
    }
  );
  return data ?? null;
}

export async function uploadOnlineStoreListingImage(
  practiceId: number,
  listingId: string,
  file: File
) {
  const form = new FormData();
  form.append('file', file);
  const { data } = await http.post<StoreAdminListing>(
    `/practice/${practiceId}/online-store/listings/${encodeURIComponent(listingId)}/image`,
    form,
    { headers: { 'Content-Type': 'multipart/form-data' } }
  );
  return data;
}

export async function patchOnlineStoreListing(
  practiceId: number,
  listingId: string,
  body: {
    approvalTag?: 'approved' | 'needs_doctor_approval';
    listed?: boolean;
    recommendedFrequency?: string | null;
    featuredOnHome?: boolean;
    description?: string | null;
    name?: string;
    storeCategory?: string | null;
    saleType?: StoreSaleType | null;
    saleValue?: number | null;
    saleEndsAt?: string | null;
    saleLabel?: string | null;
  }
) {
  const { data } = await http.patch<StoreAdminListing>(
    `/practice/${practiceId}/online-store/listings/${encodeURIComponent(listingId)}`,
    body
  );
  return data;
}

export async function patchOnlineStoreItem(
  practiceId: number,
  inventoryItemId: number,
  body: {
    approvalTag?: 'approved' | 'needs_doctor_approval';
    listed?: boolean;
    recommendedFrequency?: string | null;
    featuredOnHome?: boolean;
    storeCategory?: string | null;
  }
) {
  const { data } = await http.patch(
    `/practice/${practiceId}/online-store/items/${inventoryItemId}`,
    body
  );
  return data;
}

export async function listUnlistedStoreItems(practiceId: number, q?: string) {
  const { data } = await http.get<
    Array<{
      id: number;
      name: string;
      code: string | null;
      catalogItemType?: 'inventory' | 'procedure';
    }>
  >(`/practice/${practiceId}/online-store/unlisted-items`, {
    params: q ? { q } : undefined,
  });
  return data ?? [];
}

export async function bulkPatchOnlineStoreItems(
  practiceId: number,
  body: { recommendedFrequency?: string | null; onlyMissing?: boolean }
) {
  const { data } = await http.patch<StoreItemRow[]>(
    `/practice/${practiceId}/online-store/items`,
    body
  );
  return data ?? [];
}

export async function listStoreCoupons(practiceId: number) {
  const { data } = await http.get<StoreCoupon[]>(
    `/practice/${practiceId}/online-store/coupons`
  );
  return data ?? [];
}

export async function saveStoreCoupon(practiceId: number, body: Partial<StoreCoupon> & { code: string; name: string }) {
  const { data } = await http.post<StoreCoupon>(
    `/practice/${practiceId}/online-store/coupons`,
    body
  );
  return data;
}

export async function getMailOrder(practiceId: number, id: number) {
  const { data } = await http.get<MailOrder>(`/practice/${practiceId}/mail-orders/${id}`);
  return data;
}

export async function listMailOrders(
  practiceId: number,
  status?: string,
  patientId?: number,
) {
  const { data } = await http.get<MailOrder[]>(`/practice/${practiceId}/mail-orders`, {
    params: {
      ...(status ? { status } : {}),
      ...(patientId != null ? { patientId } : {}),
    },
  });
  return data ?? [];
}

export async function createStaffMailOrder(
  practiceId: number,
  body: {
    origin: MailOrder['origin'];
    customerName: string;
    customerEmail?: string;
    clientId?: number | null;
    patientId?: number | null;
    patientName?: string | null;
    notes?: string;
    paymentStatus?: MailOrder['paymentStatus'];
    shippingPaymentStatus?: MailOrder['shippingPaymentStatus'];
    doctorEmployeeId?: number | null;
    createdByEmployeeId?: number | null;
    shippingChargeName?: string | null;
    shipping?: number;
    packageShipment?: boolean;
    ship?: {
      name?: string;
      line1?: string;
      city?: string;
      state?: string;
      postal?: string;
    };
    lines: Array<{
      inventoryItemId?: number | null;
      name: string;
      quantity: number;
      kitKind?: 'fecal' | 'urine' | null;
      needsApproval?: boolean;
    }>;
  }
) {
  const { data } = await http.post<MailOrder>(`/practice/${practiceId}/mail-orders`, body);
  return data;
}

export async function patchMailOrder(
  practiceId: number,
  id: number,
  body: Partial<MailOrder>
) {
  const { data } = await http.patch<MailOrder>(
    `/practice/${practiceId}/mail-orders/${id}`,
    body
  );
  return data;
}

export async function advanceMailProcess(
  practiceId: number,
  id: number,
  step: MailProcessStatus
) {
  const { data } = await http.post<MailOrder>(
    `/practice/${practiceId}/mail-orders/${id}/process`,
    { step }
  );
  return data;
}

export async function requestMailLineApproval(
  practiceId: number,
  orderId: number,
  lineId: number
) {
  const { data } = await http.post<MailOrder>(
    `/practice/${practiceId}/mail-orders/${orderId}/lines/${lineId}/request-approval`
  );
  return data;
}

export async function sendMailApprovalTask(
  practiceId: number,
  orderId: number,
  body: { assignedToEmployeeId: number; notes?: string },
) {
  const { data } = await http.post<MailOrder>(
    `/practice/${practiceId}/mail-orders/${orderId}/approval-task`,
    body,
  );
  return data;
}

export async function respondMailApproval(
  practiceId: number,
  orderId: number,
  body: {
    outcome: 'approved' | 'rejected' | 'send_back';
    notes?: string;
    lineRefills?: Array<{ lineId: number; refills: number; expiration?: string | null }>;
    lineScripts?: Array<{ lineId: number; scriptText: string }>;
  },
) {
  const { data } = await http.post<MailOrder>(
    `/practice/${practiceId}/mail-orders/${orderId}/approval-response`,
    body,
  );
  return data;
}

export async function pharmacyMailAction(
  practiceId: number,
  orderId: number,
  body: {
    action:
      | 'fill'
      | 'check'
      | 'rtg'
      | 'ready_for_pickup'
      | 'reject'
      | 'note'
      | 'notify'
      | 'complete'
      | 'ready_for_check'
      | 'update_script'
      | 'skip_contact'
      | 'thanks'
      | 'check_override';
    notes?: string;
    checkNotes?: string;
    message?: string;
    subject?: string;
    fillBranchId?: number;
    lineId?: number;
    scriptText?: string;
    recordContact?: boolean;
    lineLots?: Array<{
      lineId: number;
      inventoryLotBalanceId?: number | null;
      lotNumber?: string | null;
    }>;
  },
) {
  const { data } = await http.post<MailOrder>(
    `/practice/${practiceId}/mail-orders/${orderId}/pharmacy`,
    body,
  );
  return data;
}

export async function addMailApprovalNote(
  practiceId: number,
  orderId: number,
  notes: string,
) {
  const { data } = await http.post<MailOrder>(
    `/practice/${practiceId}/mail-orders/${orderId}/approval-note`,
    { notes },
  );
  return data;
}

export async function approveMailLine(
  practiceId: number,
  orderId: number,
  lineId: number
) {
  const { data } = await http.post<MailOrder>(
    `/practice/${practiceId}/mail-orders/${orderId}/lines/${lineId}/approve`
  );
  return data;
}

export type MailParcelType = 'letter' | 'flat' | 'mailer' | 'small_box' | 'custom';

export type MailParcel = {
  type?: MailParcelType;
  weightOz: number;
  lengthIn?: number | null;
  widthIn?: number | null;
  heightIn?: number | null;
};

export type MailPackHint = {
  label: string;
  type: MailParcelType;
  lengthIn: number;
  widthIn: number;
  heightIn: number;
  carrier: string;
  service: string;
  rate: string;
  save: string;
};

export type MailRateQuote = {
  rates: Array<{ id: string; carrier: string; service: string; rate: string }>;
  carriers: string[];
  notes: string[];
  blockedCarriers?: string[];
  shipFrom?: { name?: string; city?: string; zip?: string } | null;
  packHints?: MailPackHint[];
};

export async function fetchMailRates(
  practiceId: number,
  orderId: number,
  parcel: MailParcel
) {
  const { data } = await http.post<MailRateQuote>(
    `/practice/${practiceId}/mail-orders/${orderId}/rates`,
    parcel
  );
  return {
    rates: data?.rates ?? [],
    carriers: data?.carriers ?? [],
    notes: data?.notes ?? [],
    blockedCarriers: data?.blockedCarriers ?? [],
    shipFrom: data?.shipFrom ?? null,
    packHints: data?.packHints ?? [],
  };
}

export async function refundMailLabel(practiceId: number, orderId: number) {
  const { data } = await http.post<MailOrder>(
    `/practice/${practiceId}/mail-orders/${orderId}/label/refund`,
  );
  return data;
}

export async function buyMailLabel(
  practiceId: number,
  orderId: number,
  body: MailParcel & { rateId?: string }
) {
  const { data } = await http.post<MailOrder>(
    `/practice/${practiceId}/mail-orders/${orderId}/label`,
    body
  );
  return data;
}

export type StoreStaffSubscription = StoreAutoship & {
  clientId?: number | null;
  customerName?: string | null;
  customerEmail?: string | null;
  mailOrderId?: number | null;
  stripeCustomerId?: string | null;
};

export async function listStoreSubscriptions(practiceId: number) {
  const { data } = await http.get<StoreStaffSubscription[]>(
    `/practice/${practiceId}/online-store/subscriptions`
  );
  return data ?? [];
}

export async function patchStoreSubscription(
  practiceId: number,
  id: number,
  body: {
    quantity?: number;
    frequency?: string;
    paused?: boolean;
    cancel?: boolean;
    renewalDate?: string;
    active?: boolean;
  },
) {
  const { data } = await http.patch<StoreStaffSubscription>(
    `/practice/${practiceId}/online-store/subscriptions/${id}`,
    body,
  );
  return data;
}

export type AbandonedCartLine = {
  name: string;
  quantity: number;
  unitPrice?: number;
  inventoryItemId?: number | null;
  autoshipFrequency?: string | null;
  patientIds?: number[];
  patientNames?: string[];
};

export type AbandonedCart = {
  id: number;
  email: string;
  clientId: number | null;
  customerName: string | null;
  fulfillmentLabel: string | null;
  estimatedTotal: number | null;
  lines: AbandonedCartLine[];
  touchedAt: string;
  reminderSentAt: string | null;
  reminderCount: number;
  recoveredAt: string | null;
  recoveredMailOrderId: number | null;
  recoveredTotal: number | null;
  status: 'open' | 'emailed' | 'recovered';
  emailed: boolean;
};

export type AbandonedCartsPayload = {
  carts: AbandonedCart[];
  stats: {
    totalCarts: number;
    recoveredCount: number;
    recoveredSales: number;
    emailedCount: number;
    automaticRecoveryEnabled: boolean;
  };
};

export async function listAbandonedCarts(practiceId: number) {
  const { data } = await http.get<AbandonedCartsPayload>(
    `/practice/${practiceId}/online-store/abandoned-carts`,
  );
  return data;
}

export async function resendAbandonedCart(practiceId: number, id: number) {
  const { data } = await http.post<AbandonedCart>(
    `/practice/${practiceId}/online-store/abandoned-carts/${id}/resend`,
  );
  return data;
}

export type StoreCategory = {
  id: number;
  name: string;
  sortOrder: number;
  source: 'ecwid' | 'manual';
  productCount: number;
};

export async function listStoreCategories(practiceId: number) {
  const { data } = await http.get<StoreCategory[]>(
    `/practice/${practiceId}/online-store/categories`,
  );
  return data ?? [];
}

export async function createStoreCategory(practiceId: number, name: string) {
  const { data } = await http.post<StoreCategory>(
    `/practice/${practiceId}/online-store/categories`,
    { name },
  );
  return data;
}

export async function patchStoreCategory(
  practiceId: number,
  id: number,
  body: { name?: string; sortOrder?: number },
) {
  const { data } = await http.patch<StoreCategory>(
    `/practice/${practiceId}/online-store/categories/${id}`,
    body,
  );
  return data;
}

export async function deleteStoreCategory(practiceId: number, id: number) {
  await http.delete(`/practice/${practiceId}/online-store/categories/${id}`);
}

export async function syncStoreCategoriesFromEcwid(practiceId: number) {
  const { data } = await http.post<{ added: number; total: number }>(
    `/practice/${practiceId}/online-store/categories/sync-ecwid`,
  );
  return data;
}

export async function publicStoreProducts(
  practiceId: number,
  q?: string,
  category?: string
) {
  const { data } = await http.get<StoreListing[]>(`/public/store/products`, {
    params: { practiceId, q, category },
  });
  return data ?? [];
}

export async function publicStoreProduct(practiceId: number, id: string | number) {
  const { data } = await http.get<StoreListing>(`/public/store/products/${id}`, {
    params: { practiceId },
  });
  return data;
}

export type StoreFulfillmentOption = {
  id: string;
  label: string;
  kind: 'pickup' | 'shipping';
  charge: 'none' | 'courtesy' | 'amount';
  amount: number;
  catalogItemId?: number | null;
  catalogItemType?: 'procedure' | 'inventory' | null;
  estimatedDaysToFill?: number | null;
  autoshipAllowed?: boolean;
  autoshipOnly?: boolean;
  autoship?: boolean;
  showOnOnlineStore?: boolean;
  clientInstructions?: string | null;
  pickupLocation?: {
    name: string;
    line1?: string | null;
    line2?: string | null;
    city?: string | null;
    state?: string | null;
    postal?: string | null;
  } | null;
};

export async function publicStoreTax(practiceId: number) {
  const { data } = await http.get<{
    name: string;
    rate: number;
    level2Rate: number;
    level3Rate: number;
  }>(`/public/store/tax`, { params: { practiceId } });
  return data;
}

export async function publicStoreFulfillment(practiceId: number) {
  const { data } = await http.get<StoreFulfillmentOption[]>(`/public/store/fulfillment`, {
    params: { practiceId },
  });
  return data ?? [];
}

export type StoreSavedCard = {
  paymentMethodId: string;
  brand?: string | null;
  last4?: string | null;
  expMonth?: number | null;
  expYear?: number | null;
  recommended?: boolean;
};

export async function publicStoreCardOnFile(practiceId: number, email: string) {
  const { data } = await http.post<{
    hasCard: boolean;
    brand?: string | null;
    last4?: string | null;
    cards?: StoreSavedCard[];
  }>(`/public/store/card-on-file`, { practiceId, email });
  return data;
}

export async function publicStoreCartActivity(
  practiceId: number,
  body: {
    email: string;
    clientId?: number | null;
    customerName?: string | null;
    fulfillmentLabel?: string | null;
    estimatedTotal?: number | null;
    lines: Array<{
      name: string;
      quantity: number;
      unitPrice?: number;
      inventoryItemId?: number | null;
      autoshipFrequency?: string | null;
      patientIds?: number[];
      patientNames?: string[];
    }>;
  }
) {
  await http.post(`/public/store/cart-activity`, { practiceId, ...body });
}

export async function publicPreviewCoupon(
  practiceId: number,
  code: string,
  subtotal: number
) {
  const { data } = await http.post<{
    code: string;
    name: string;
    discount: number;
    freeShipping: boolean;
  }>(`/public/store/coupon`, { practiceId, code, subtotal });
  return data;
}

export async function publicCheckout(
  practiceId: number,
  body: {
    customerName: string;
    customerEmail?: string;
    couponCode?: string;
    paymentMethodId?: string | null;
    saveCard?: boolean;
    clientId?: number | null;
    patientId?: number | null;
    fulfillmentId?: string | null;
    ship: {
      name?: string;
      line1?: string;
      line2?: string;
      city?: string;
      state?: string;
      postal?: string;
    };
    lines: Array<{
      inventoryItemId: number;
      quantity: number;
      autoshipFrequency?: string | null;
      patientIds?: number[] | null;
    }>;
  }
) {
  try {
    const { data } = await http.post<MailOrder>(`/public/store/checkout`, {
      practiceId,
      ...body,
    });
    return data;
  } catch (err) {
    throw new Error(storeApiError(err));
  }
}

export type StoreAutoship = {
  id: number;
  itemName: string | null;
  inventoryItemId: number;
  quantity: number;
  unitPrice: number;
  frequency: string;
  renewalDate: string;
  fulfillmentKind: string | null;
  patientId?: number | null;
  patientName?: string | null;
  active: boolean;
  paused: boolean;
  stripeSubscriptionId: string | null;
};

export async function listMyAutoship(practiceId: number) {
  const { data } = await http.get<StoreAutoship[]>(`/store/autoship`, {
    params: { practiceId },
  });
  return data;
}

export async function patchMyAutoship(
  practiceId: number,
  id: number,
  body: { quantity?: number; frequency?: string; paused?: boolean; cancel?: boolean },
) {
  const { data } = await http.patch<StoreAutoship>(`/store/autoship/${id}`, body, {
    params: { practiceId },
  });
  return data;
}

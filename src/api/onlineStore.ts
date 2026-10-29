import axios, { AxiosHeaders, type AxiosRequestHeaders } from 'axios';
import { apiBaseUrl, http, practiceHostHeaders } from './http';

/** Public catalog / checkout calls — no staff JWT, so Room Loader links cannot trigger logout. */
const publicStoreClient = axios.create({
  baseURL: apiBaseUrl,
  withCredentials: false,
});

publicStoreClient.interceptors.request.use((config) => {
  const headers = AxiosHeaders.from(config.headers || {}) as AxiosHeaders;
  for (const [name, value] of Object.entries(practiceHostHeaders())) {
    if (!headers.has(name)) headers.set(name, value);
  }
  config.headers = headers as AxiosRequestHeaders;
  return config;
});

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
  serviceFee?: number | null;
  minimumPrice?: number | null;
  priceBreaks?: StorePriceBreak[];
  strength: string | null;
  pack: string;
  hasImage?: boolean;
  optionLabel?: string | null;
  recommendedFrequency?: string | null;
  taxLevelValue?: number | null;
  approvalTag?: 'approved' | 'needs_doctor_approval';
  tagalongs?: StoreTagalongPreview[];
  reminderCadence?: StoreReminderCadence | null;
  availability?: StoreVariantAvailability;
};

export type StoreAvailabilityMode = 'always' | 'out_of_stock' | 'stock';

export type StoreVariantAvailability = {
  /** `backorder` = unavailable but clients may still order. */
  status: 'available' | 'out_of_stock' | 'backorder';
  /** Units left to sell; null = unlimited. */
  available: number | null;
  backInStockDate: string | null;
};

export type StoreAvailabilityDetail = StoreVariantAvailability & {
  mode: StoreAvailabilityMode;
  /** Only when tied to stock: counts at the online-store fulfillment location. */
  onHand: number | null;
  reserved: number | null;
  buffer: number;
  locationName: string | null;
  /** Tied to stock, but the shelf hasn't had its first count: sold as always available. */
  notYetCounted?: boolean;
};

export async function getStoreItemAvailability(practiceId: number, inventoryItemId: number) {
  const { data } = await http.get<StoreAvailabilityDetail | null>(
    `/practice/${practiceId}/online-store/items/${inventoryItemId}/availability`,
  );
  return data ?? null;
}

/** Variant can go in the cart (available, or unavailable with backorder allowed). */
export function storeVariantOrderable(variant?: Pick<StoreVariant, 'availability'> | null): boolean {
  return variant?.availability?.status !== 'out_of_stock';
}

export function formatBackInStock(date: string | null | undefined): string | null {
  if (!date) return null;
  const d = new Date(`${date.slice(0, 10)}T12:00:00`);
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export type StoreReminderCadence = {
  dueAt: number;
  periodUnit: string;
  adjustByQuantity: boolean;
};

export type StoreTagalongPreview = {
  ruleId: number;
  addItemType: string;
  addItemId: number;
  name: string;
  unitPrice: number;
  minQty: number;
  maxQty: number | null;
  addQty: number;
  addQtyMode: 'fixed' | 'match_trigger';
  taxMode: 'after_tax' | 'before_tax';
  taxLevelValue: number | null;
};

export type StoreSaleType = 'amount' | 'percent';

export type StoreListing = {
  listingId: string;
  name: string;
  storeCategory: string | null;
  /** Every category the listing shows under; the first is storeCategory. */
  storeCategories?: string[];
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
  /** gift_card listings have no variants; the buyer picks an amount instead. */
  kind?: 'standard' | 'gift_card';
  requiresPet?: boolean;
  giftCard?: StoreGiftCardSettings | null;
  variants: StoreVariant[];
};

export type StoreGiftCardSettings = {
  amounts: number[];
  allowCustom: boolean;
  min: number | null;
  max: number | null;
  terms: string | null;
  /** What buyers see: these terms, or the standard ones when none are set. */
  displayTerms?: string | null;
};

/** Staff edits to a listing's gift card / pet settings. */
export type StoreListingGiftCardPatch = {
  kind?: 'standard' | 'gift_card';
  requiresPet?: boolean;
  giftCardAmounts?: number[] | null;
  giftCardAllowCustom?: boolean;
  giftCardMin?: number | null;
  giftCardMax?: number | null;
  giftCardTerms?: string | null;
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
    | 'check_override'
    | 'passed_through'
    | 'doctor';
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
  /** Doctor written on the existing prescription, when this line is a refill. */
  scriptPrescriberEmployeeId?: number | null;
  scriptPrescriberName?: string | null;
  name: string;
  strength: string | null;
  quantity: number;
  unitPrice: number;
  autoshipFrequency: string | null;
  renewalDate: string | null;
  lineStatus: 'ok_to_mail' | 'awaiting_doctor_approval' | 'rejected' | 'send_back';
  approvalDecision?: 'approved' | 'rejected' | 'send_back' | null;
  approvalTaskId?: number | null;
  approvalTaskAssigneeName?: string | null;
  approvalTaskWatcherNames?: string[];
  approvalTaskOpen?: boolean;
  refillNote?: string | null;
  /** Refills the approving doctor wants the filler to put on this Rx. */
  authorizedRefills?: number | null;
  authorizedRefillExpiration?: string | null;
  authorizedAcuity?: MailRxAcuity | null;
  refillsRemaining?: number | null;
  refillExpiresAt?: string | null;
  scriptText?: string | null;
  autoship?: boolean;
  subscriptionId?: number | null;
  subscriptionPaused?: boolean;
  kitKind: 'fecal' | 'urine' | null;
  inventoryLotBalanceId?: number | null;
  lotNumber?: string | null;
  stockInventoryItemId?: number | null;
  trackLots?: boolean;
  checkedAt?: string | null;
  checkedByEmployeeId?: number | null;
  checkedByName?: string | null;
  /** `external` = passed through: ordered on another site that drop-ships to the client. Null until filled. */
  fulfillmentSource?: MailFulfillmentSource | null;
  externalVendor?: string | null;
  /** Order number on the other site. */
  externalOrderRef?: string | null;
  externalOrderedAt?: string | null;
  externalOrderedByName?: string | null;
  /** Catalog item is usually drop-shipped; pre-selects "ordered on another site" at fill. */
  passThroughByDefault?: boolean;
  defaultExternalVendor?: string | null;
  /** Unfilled line whose store item is marked out of stock, or the mail order shelf can't cover open orders. */
  stockFlag?: 'out_of_stock' | 'short' | null;
  stockBackInStockDate?: string | null;
};

export type MailFulfillmentSource = 'stock' | 'external';

export function mailLinePassedThrough(line: Pick<MailOrderLine, 'fulfillmentSource'>): boolean {
  return line.fulfillmentSource === 'external';
}

export type MailPharmacyStage =
  | 'needs_approval'
  | 'pending_client'
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
  /** Staff waived payment before fill/ship; order is not done until paid. */
  sendWithoutPayment?: boolean;
  /** Taken before payment; the mail order team collects once the doctor approves. */
  payAfterApproval?: boolean;
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
  clientQuestionPendingAt?: string | null;
  cancelRequestedAt?: string | null;
  cancelRequestedByName?: string | null;
  cancelRequestReason?: MailCancelReason | null;
  cancelRequestNote?: string | null;
  cancelResolution?: MailCancelResolution | null;
  cancelResolvedAt?: string | null;
  cancelResolvedByName?: string | null;
  cancelResolutionNote?: string | null;
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
  /**
   * Open Scout account balance excluding this mail order’s linked invoice.
   * Shown in red when the household owes money beyond this order.
   */
  otherBalanceDue?: number | null;
  /** Unrefunded total for rejected line(s). */
  rejectedRefundDue?: number | null;
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
  minSubtotal?: number | null;
  maxUses?: number | null;
  oncePerCustomer?: boolean;
  usedCount?: number;
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

export async function downloadStoreCatalog(practiceId: number) {
  const res = await http.get<Blob>(
    `/practice/${practiceId}/online-store/catalog-export`,
    { responseType: 'blob' },
  );
  const blob = res.data;
  const headerType = String(res.headers?.['content-type'] || '');
  if (blob instanceof Blob && (blob.type.includes('json') || headerType.includes('json'))) {
    const text = await blob.text();
    let message = 'Could not download the catalog.';
    try {
      const parsed = JSON.parse(text) as { message?: unknown };
      if (typeof parsed.message === 'string' && parsed.message.trim()) message = parsed.message;
    } catch {
      if (text.trim()) message = text.trim();
    }
    throw new Error(message);
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'scout-store-catalog.zip';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function importStoreCatalog(practiceId: number, file: File) {
  const form = new FormData();
  form.append('file', file);
  const { data } = await http.post<{
    products: number;
    variants: number;
    images: number;
    unlisted?: number;
    unmatched: Array<{ productName: string; itemName: string; reason: string }>;
  }>(`/practice/${practiceId}/online-store/catalog-import`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
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

export async function listOnlineStoreListings(
  practiceId: number,
  opts?: { includeRemoved?: boolean }
) {
  const { data } = await http.get<StoreAdminListing[]>(
    `/practice/${practiceId}/online-store/listings`,
    opts?.includeRemoved ? { params: { includeRemoved: '1' } } : undefined
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
  } & StoreListingGiftCardPatch
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
    storeCategories?: string[];
    saleType?: StoreSaleType | null;
    saleValue?: number | null;
    saleEndsAt?: string | null;
    saleLabel?: string | null;
  } & StoreListingGiftCardPatch
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
  body: {
    inventoryItemIds?: number[];
    recommendedFrequency?: string | null;
    onlyMissing?: boolean;
  }
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

export async function deleteStoreCoupon(practiceId: number, id: number) {
  await http.delete(`/practice/${practiceId}/online-store/coupons/${id}`);
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
    sendWithoutPayment?: boolean;
    payAfterApproval?: boolean;
    doctorEmployeeId?: number | null;
    createdByEmployeeId?: number | null;
    shippingChargeName?: string | null;
    shipping?: number;
    packageShipment?: boolean;
    ship?: {
      name?: string;
      line1?: string;
      line2?: string;
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

export type MailCancelReason = 'client_changed_mind' | 'wrong_item_or_qty' | 'duplicate' | 'other';
export type MailCancelResolution = 'cancelled' | 'cancelled_refund' | 'already_shipped' | 'kept';

export const MAIL_CANCEL_REASON_LABELS: Record<MailCancelReason, string> = {
  client_changed_mind: 'Client changed their mind',
  wrong_item_or_qty: 'Wrong item or quantity',
  duplicate: 'Duplicate order',
  other: 'Other',
};

/**
 * The mail team has started (moved it, filled, bought a label, contacted the
 * client). Staff then request a cancellation rather than pulling it back.
 */
export function mailOrderWorkedOn(order: MailOrder): boolean {
  return (
    (order.processStatus || 'queued') !== 'queued' ||
    Boolean(order.filledAt) ||
    order.fillerEmployeeId != null ||
    Boolean(order.labelUrl) ||
    Boolean(order.clientContactedAt) ||
    ['packed', 'shipped', 'picked_up'].includes(order.status)
  );
}

export function mailCancelPending(order: MailOrder): boolean {
  return Boolean(order.cancelRequestedAt) && !order.cancelResolvedAt;
}

/** Take an invoice line back off the queue; refused once the mail team starts or payment is taken. */
export async function withdrawMailOrder(practiceId: number, id: number) {
  const { data } = await http.post<MailOrder>(
    `/practice/${practiceId}/mail-orders/${id}/withdraw`,
    {}
  );
  return data;
}

export async function requestMailOrderCancellation(
  practiceId: number,
  id: number,
  body: { reason: MailCancelReason; note?: string | null }
) {
  const { data } = await http.post<MailOrder>(
    `/practice/${practiceId}/mail-orders/${id}/cancel-request`,
    body
  );
  return data;
}

export async function resolveMailOrderCancellation(
  practiceId: number,
  id: number,
  body: { resolution: MailCancelResolution; note?: string | null }
) {
  const { data } = await http.post<{
    order: MailOrder;
    refund: {
      invoiceId: string;
      clientId: number | null;
      lineId: string;
      shippingLineId: string | null;
    } | null;
  }>(`/practice/${practiceId}/mail-orders/${id}/cancel-resolve`, body);
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
  body: {
    assignedToEmployeeId: number;
    notes?: string;
    lineIds?: number[];
  },
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
    approvalBasis?: 'standard' | 'chart' | 'refills';
    taskId?: number;
    lineIds?: number[];
    lineRefills?: MailLineRxDecision[];
    lineScripts?: Array<{ lineId: number; scriptText: string }>;
  },
) {
  const { data } = await http.post<MailOrder>(
    `/practice/${practiceId}/mail-orders/${orderId}/approval-response`,
    body,
  );
  return data;
}

export type MailRxAcuity = 'acute' | 'chronic';

/** What the approver puts on the Rx for one mail order line. */
export type MailLineRxDecision = {
  lineId: number;
  refills: number;
  expiration?: string | null;
  acuity?: MailRxAcuity | null;
};

export async function overrideMailLineApproval(
  practiceId: number,
  orderId: number,
  lineId: number,
  reason: string,
  rx?: { refills: number; expiration?: string | null; acuity: MailRxAcuity },
) {
  const { data } = await http.post<MailOrder>(
    `/practice/${practiceId}/mail-orders/${orderId}/lines/${lineId}/override-approval`,
    { reason, ...(rx ?? {}) },
  );
  return data;
}

export async function splitMailOrder(
  practiceId: number,
  orderId: number,
  lineIds: number[],
) {
  const { data } = await http.post<{ original: MailOrder; split: MailOrder }>(
    `/practice/${practiceId}/mail-orders/${orderId}/split`,
    { lineIds },
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
      | 'email_sent'
      | 'refund_rejected'
      | 'complete'
      | 'ready_for_check'
      | 'update_script'
      | 'skip_contact'
      | 'thanks'
      | 'check_override'
      | 'pending_client'
      | 'clear_client_pending'
      | 'set_doctor';
    notes?: string;
    checkNotes?: string;
    message?: string;
    subject?: string;
    fillBranchId?: number;
    fillLocationId?: number;
    lineId?: number;
    doctorEmployeeId?: number | null;
    scriptText?: string;
    recordContact?: boolean;
    rejectOutreach?: boolean;
    refundRejected?: boolean;
    /** Label for the client communications log entry. */
    typeLabel?: string;
    patientId?: number | null;
    lineIds?: number[];
    lineLots?: Array<{
      lineId: number;
      inventoryLotBalanceId?: number | null;
      lotNumber?: string | null;
    }>;
    lineSources?: Array<{
      lineId: number;
      fulfillmentSource: MailFulfillmentSource;
      externalVendor?: string | null;
      externalOrderRef?: string | null;
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
    inventoryItemId?: number;
    unitPrice?: number;
    settleMode?: 'charge' | 'refund' | 'credit' | 'auto';
    mailOrderLineId?: number;
    productChangeDisposition?: 'request_approval' | 'staff_override';
    overrideReason?: string;
    assignedToEmployeeId?: number;
    approvalNotes?: string;
    pausedUntil?: string | null;
  },
) {
  const { data } = await http.patch<
    StoreStaffSubscription & {
      settlement?: {
        delta: number;
        mode: string;
        stripeOk?: boolean;
        invoiceId?: string | null;
        message?: string;
      } | null;
    }
  >(`/practice/${practiceId}/online-store/subscriptions/${id}`, body);
  return data;
}

export async function emailStoreSubscriptionUpdate(
  practiceId: number,
  id: number,
  body: { subject: string; message: string },
) {
  const { data } = await http.post<{ ok: boolean; emailed: string }>(
    `/practice/${practiceId}/online-store/subscriptions/${id}/email`,
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
  status: 'open' | 'emailed' | 'recovered' | 'removed';
  emailed: boolean;
  dismissedAt?: string | null;
};

export type AbandonedCartsPayload = {
  carts: AbandonedCart[];
  stats: {
    totalCarts: number;
    recoveredCount: number;
    recoveredSales: number;
    emailedCount: number;
    removedCount?: number;
    automaticRecoveryEnabled: boolean;
  };
};

export async function listAbandonedCarts(practiceId: number) {
  const { data } = await http.get<AbandonedCartsPayload>(
    `/practice/${practiceId}/online-store/abandoned-carts`,
  );
  return data;
}

export type AbandonedCartEmailDraft = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  messageHtml?: string;
};

export async function previewAbandonedCartEmail(practiceId: number, id: number) {
  const { data } = await http.get<AbandonedCartEmailDraft>(
    `/practice/${practiceId}/online-store/abandoned-carts/${id}/email`,
  );
  return data;
}

export async function resendAbandonedCart(
  practiceId: number,
  id: number,
  email: { subject: string; text: string; html?: string; markOnly?: boolean },
) {
  const { data } = await http.post<AbandonedCart>(
    `/practice/${practiceId}/online-store/abandoned-carts/${id}/resend`,
    email,
  );
  return data;
}

export async function dismissAbandonedCart(practiceId: number, id: number) {
  const { data } = await http.post<AbandonedCart>(
    `/practice/${practiceId}/online-store/abandoned-carts/${id}/dismiss`,
    {},
  );
  return data;
}

export type StoreCategory = {
  id: number;
  name: string;
  sortOrder: number;
  source: 'ecwid' | 'manual';
  hidden?: boolean;
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
  body: { name?: string; sortOrder?: number; hidden?: boolean },
) {
  const { data } = await http.patch<StoreCategory>(
    `/practice/${practiceId}/online-store/categories/${id}`,
    body,
  );
  return data;
}

/** `moveTo`: category to move its products into, or '' to just take them out. */
export async function deleteStoreCategory(practiceId: number, id: number, moveTo?: string) {
  const { data } = await http.delete<{ ok: boolean; moved: number }>(
    `/practice/${practiceId}/online-store/categories/${id}`,
    { params: moveTo === undefined ? undefined : { moveTo } },
  );
  return data;
}

export async function publicHiddenStoreCategories(practiceId: number): Promise<string[]> {
  try {
    const { data } = await publicStoreClient.get<string[]>(`/public/store/categories/hidden`, {
      params: { practiceId },
    });
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export async function syncStoreCategoriesFromEcwid(practiceId: number) {
  const { data } = await http.post<{ added: number; total: number }>(
    `/practice/${practiceId}/online-store/categories/sync-ecwid`,
  );
  return data;
}

/** All of a listing's categories, falling back to storeCategory for older responses. */
export function listingCategoryNames(
  listing: Pick<StoreListing, 'storeCategory' | 'storeCategories'>
): string[] {
  if (listing.storeCategories?.length) return listing.storeCategories;
  const one = listing.storeCategory?.trim();
  return one ? [one] : [];
}

/** True when any of the listing's categories is the selected one or sits under it. */
export function listingInStoreCategory(
  listing: Pick<StoreListing, 'storeCategory' | 'storeCategories'>,
  selected: string
): boolean {
  const want = selected.trim();
  if (!want) return true;
  return listingCategoryNames(listing).some(
    (cat) => cat === want || cat.startsWith(`${want} / `) || cat.startsWith(`${want}/`)
  );
}

function asStoreListingArray(data: unknown): StoreListing[] {
  if (Array.isArray(data)) return data as StoreListing[];
  if (data && typeof data === 'object') {
    const rec = data as Record<string, unknown>;
    for (const key of ['products', 'listings', 'items', 'data', 'results']) {
      if (Array.isArray(rec[key])) return rec[key] as StoreListing[];
    }
  }
  return [];
}

function listingSearchHaystack(listing: StoreListing): string {
  return [
    listing.name,
    ...listingCategoryNames(listing),
    ...(listing.variants ?? []).flatMap((v) => [v.name, v.code, v.optionLabel, v.strength, v.pack]),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function listingMatchesQuery(listing: StoreListing, q?: string): boolean {
  const query = (q ?? '').trim().toLowerCase();
  if (query.length < 2) return true;
  const hay = listingSearchHaystack(listing);
  if (hay.includes(query)) return true;
  return query.split(/\s+/).some((word) => word.length >= 2 && hay.includes(word));
}

export async function publicStoreProducts(
  practiceId: number,
  q?: string,
  category?: string,
  token?: string
) {
  const params = { practiceId, category, ...(token ? { token } : {}) };
  const { data } = await publicStoreClient.get<unknown>(`/public/store/products`, {
    params: { ...params, ...(q?.trim() ? { q } : {}) },
  });
  const raw = asStoreListingArray(data);
  if (!q?.trim()) return raw;
  const matched = raw.filter((listing) => listingMatchesQuery(listing, q));
  if (matched.length > 0) return matched;
  // Some hosts ignore or empty-out `q`. Reload the full public catalog and match locally.
  if (raw.length === 0) {
    const { data: allData } = await publicStoreClient.get<unknown>(`/public/store/products`, { params });
    const all = asStoreListingArray(allData);
    const fromAll = all.filter((listing) => listingMatchesQuery(listing, q));
    if (fromAll.length > 0) return fromAll;
    try {
      const listed = await listOnlineStoreListings(practiceId);
      return (listed ?? []).filter((listing) => listing.listed !== false && listingMatchesQuery(listing, q));
    } catch {
      return [];
    }
  }
  return matched;
}

export async function publicStoreProduct(practiceId: number, id: string | number) {
  const { data } = await publicStoreClient.get<StoreListing>(`/public/store/products/${id}`, {
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
  subtotal: number,
  opts?: { clientId?: number | null; member?: boolean }
) {
  const { data } = await http.post<{
    code: string;
    name: string;
    discount: number;
    freeShipping: boolean;
  }>(`/public/store/coupon`, { practiceId, code, subtotal, ...opts });
  return data;
}

export type StoreOpenInvoiceLine = {
  description: string;
  amount: number;
  pet?: string | null;
  qty?: number;
  listAmount?: number | null;
  membershipBenefit?: boolean;
};

export type StoreOpenInvoicePayment = {
  date?: string;
  method?: string;
  amount: number;
};

export type StoreOpenInvoice = {
  id: string;
  source: 'scout' | 'evet';
  label: string;
  date: string | null;
  clientName?: string;
  due: number;
  subtotal?: number;
  tax?: number;
  total?: number;
  paid?: number;
  lines: StoreOpenInvoiceLine[];
  payments?: StoreOpenInvoicePayment[];
};

export type StoreAccountPosition = {
  available: number;
  owed: number;
  invoices: StoreOpenInvoice[];
};

export async function publicAccountCredit(
  practiceId: number,
  clientId: number,
  email: string,
): Promise<StoreAccountPosition> {
  const { data } = await http.post<StoreAccountPosition>(`/public/store/account-credit`, {
    practiceId,
    clientId,
    email,
  });
  return {
    available: Number(data?.available) || 0,
    owed: Number(data?.owed) || 0,
    invoices: Array.isArray(data?.invoices) ? data.invoices : [],
  };
}

export async function publicPayAccountBalance(
  practiceId: number,
  body: {
    clientId: number;
    email: string;
    paymentMethodId: string;
    customerName?: string | null;
    giftCardCodes?: string[];
  },
): Promise<{ paid: number; giftCardApplied: number; cardCharged: number }> {
  try {
    const { data } = await http.post<{ paid: number; giftCardApplied?: number; cardCharged?: number }>(
      `/public/store/pay-balance`,
      { practiceId, ...body }
    );
    return {
      paid: Number(data?.paid) || 0,
      giftCardApplied: Number(data?.giftCardApplied) || 0,
      cardCharged: Number(data?.cardCharged) || 0,
    };
  } catch (err) {
    throw new Error(storeApiError(err));
  }
}

export type GiftCardCheckoutLine = {
  kind: 'gift_card';
  listingId: string | number;
  amount: number;
  quantity?: number;
  recipientName?: string | null;
  recipientEmail?: string | null;
  fromName?: string | null;
  message?: string | null;
  deliverAt?: string | null;
  sendToSelf?: boolean;
};

export type PurchasedGiftCard = {
  id: string;
  last4: string;
  faceValue: number;
  amountPaid: number;
  recipientName: string | null;
  recipientEmail: string | null;
  deliverAt: string | null;
  status: string;
  /** Null when the card went to someone else; only the recipient gets the code. */
  printUrl: string | null;
};

export type StoreCheckoutResult = Omit<MailOrder, 'id'> & {
  id: number | null;
  kind?: 'gift_cards';
  giftCards?: PurchasedGiftCard[];
};

export async function publicCheckout(
  practiceId: number,
  body: {
    customerName: string;
    customerEmail?: string;
    couponCode?: string;
    applyAccountCredit?: boolean;
    payOutstanding?: boolean;
    paymentMethodId?: string | null;
    saveCard?: boolean;
    updateMailingOnFile?: boolean;
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
    giftCardCodes?: string[];
    lines: Array<
      | {
          inventoryItemId: number;
          quantity: number;
          autoshipFrequency?: string | null;
          patientIds?: number[] | null;
        }
      | GiftCardCheckoutLine
    >;
  }
) {
  try {
    const { data } = await http.post<StoreCheckoutResult>(`/public/store/checkout`, {
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
  pausedUntil?: string | null;
  stripeSubscriptionId: string | null;
};

export type StoreMemberDiscount = {
  patientId: number;
  percent: number;
};

export async function listMyStoreMemberDiscounts(practiceId: number) {
  const { data } = await http.get<StoreMemberDiscount[]>(`/store/autoship/member-discounts`, {
    params: { practiceId },
  });
  return data;
}

export async function listMyAutoship(practiceId: number) {
  const { data } = await http.get<StoreAutoship[]>(`/store/autoship`, {
    params: { practiceId },
  });
  return data;
}

export async function patchMyAutoship(
  practiceId: number,
  id: number,
  body: {
    quantity?: number;
    frequency?: string;
    paused?: boolean;
    /** YYYY-MM-DD — required when pausing. */
    pausedUntil?: string | null;
    /** YYYY-MM-DD — move the next shipment to this day. */
    renewalDate?: string;
    cancel?: boolean;
  },
) {
  const { data } = await http.patch<StoreAutoship>(`/store/autoship/${id}`, body, {
    params: { practiceId },
  });
  return data;
}

// src/api/roomLoader.ts
import { http } from './http';

export type SentStatus = 'not_sent' | 'sent_1' | 'sent_2' | 'completed';
export type DueStatus = 'due' | 'past_due' | 'upcoming' | '10_days_before' | '6_days_before' | '10_days_past_due';

export type Practice = {
  id: number;
  name: string;
  isActive: boolean;
  isDeleted: boolean;
  pimsId?: string | null;
  pimsType?: string;
};

export type Client = {
  id: number;
  isActive: boolean;
  isDeleted: boolean;
  pimsId?: string | null;
  pimsType?: string;
  firstName: string;
  lastName: string;
  secondFirstName?: string | null;
  secondLastName?: string | null;
  email?: string | null;
  secondEmail?: string | null;
  phone1?: string | null;
  phone2?: string | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  state?: string | null;
  zipcode?: string | null;
  county?: string | null;
  country?: string | null;
  statusDiscount?: number;
  discount?: number;
  lat?: number | null;
  lon?: number | null;
  latLonMatchLevel?: string | null;
  latLonValidated?: boolean;
  username?: string | null;
  alerts?: string | null;
};

export type Reminder = {
  id: number;
  created?: string;
  updated?: string;
  externalCreated?: string;
  externalUpdated?: string;
  isActive: boolean;
  pimsId?: string | null;
  pimsType?: string;
  isDeleted: boolean;
  description: string;
  dueDate?: string | null;
  dueDateSuggestionType?: string | null;
  numberOfDays?: number | null;
  patientReminderOwner?: string | null;
  startReminding?: string | null;
  stopReminding?: string | null;
  reminderType?: string | null;
  isSatisfied?: boolean | null;
  practice?: Practice;
  patient?: {
    id: number;
    name?: string;
    [key: string]: any;
  };
  employee?: any | null;
};

export type ReminderWithPrice = {
  reminder: Reminder;
  confidence: number;
  price: number | null;
  itemType: string | null;
  matchedItem?: {
    id: number;
    code?: string;
    name?: string;
    price?: string;
    category?: string;
    cost?: string;
    serviceFee?: string;
  } | null;
  wellnessPlanPricing?: {
    hasCoverage: boolean;
    adjustedPrice: number;
    originalPrice: number;
    includedQuantity: number;
    usedQuantity: number;
    remainingQuantity: number;
    isWithinLimit: boolean;
    priceAdjustedByMembership?: boolean;
    membershipPlanName?: string;
    membershipDiscountAmount?: number;
    clientDiscounts?: Record<string, any>;
  };
  discountPricing?: {
    priceAdjustedByDiscount: boolean;
    discountAmount?: number;
    discountPercentage?: number;
    clientDiscounts?: {
      clientStatusDiscount?: {
        discount: number;
        discountType: string;
        clientStatusName?: string;
        clientStatusCode?: string;
      };
      personalDiscount?: {
        discount: number;
      };
      totalDiscountAmount?: number;
      totalDiscountPercentage?: number;
    };
  };
  tieredPricing?: {
    hasTieredPricing: boolean;
    priceBreaks?: Array<{
      lowQuantity: string;
      highQuantity: string;
      price: string;
      markup: string;
      isActive: boolean;
    }>;
  };
};

export type Patient = {
  id: number;
  isActive: boolean;
  isDeleted: boolean;
  pimsId?: string | null;
  pimsType?: string;
  name: string;
  species?: string | null;
  breed?: string | null;
  color?: string | null;
  weight?: number | null;
  dob?: string | null;
  sex?: string | null;
  alerts?: string | null;
  imageUrl?: string | null;
  practice?: Practice;
  primaryProvider?: {
    id: number;
    firstName?: string;
    lastName?: string;
    title?: string;
    isProvider?: boolean;
  };
  clients?: Array<{
    id: number;
    firstName?: string;
    lastName?: string;
    email?: string | null;
    phone1?: string | null;
  }>;
  /** Explicit membership flag from room loader API (preferred over deriving from reminders). */
  isMember?: boolean;
  /** Membership plan name when isMember is true. */
  membershipName?: string | null;
  breedEntity?: {
    id: number;
    name: string;
    isActive?: boolean;
  };
  speciesEntity?: {
    id: number;
    name: string;
    isActive?: boolean;
  };
  created?: string;
  updated?: string;
  reminders?: ReminderWithPrice[];
  declinedInventoryItems?: DeclinedInventoryItem[];
};

export type PrimaryProvider = {
  id: number;
  isActive: boolean;
  isDeleted: boolean;
  pimsId?: string | null;
  pimsType?: string;
  firstName: string;
  lastName: string;
  email?: string | null;
  title?: string | null;
  designation?: string | null;
  isProvider?: boolean;
  phone1?: string | null;
};

export type AppointmentType = {
  id: number;
  isActive: boolean;
  isDeleted: boolean;
  pimsId?: string | null;
  pimsType?: string;
  name: string;
  prettyName?: string | null;
  defaultDuration?: number;
  isBoardingType?: boolean;
  hasExtraInstructions?: boolean;
  showInApptRequestForm?: boolean;
  newPatientAllowed?: boolean;
};

export type Appointment = {
  id: number;
  isActive: boolean;
  isDeleted: boolean;
  pimsId?: string | null;
  pimsType?: string;
  description?: string | null;
  appointmentStart: string;
  appointmentEnd: string;
  isComplete: boolean;
  allDay: boolean;
  instructions?: string | null;
  equipment?: string | null;
  medications?: string | null;
  confirmStatusId?: number;
  statusId?: number;
  confirmStatusName?: string | null;
  statusName?: string | null;
  practice?: Practice;
  client?: Client;
  patient?: Patient;
  primaryProvider?: PrimaryProvider;
  appointmentType?: AppointmentType;
  treatment?: any | null;
  created?: string;
  updated?: string;
  // For externally created appointments
  externallyCreated?: boolean;
  externalCreated?: string; // External creation timestamp
  bookedDate?: string | null;
  /** Arrival window for the client (e.g. "11:20 AM - 1:20 PM") */
  arrivalWindow?: {
    windowStartIso?: string | null;
    windowEndIso?: string | null;
    windowStartLocal?: string | null;
    windowEndLocal?: string | null;
  } | null;
};

export type DeclinedInventoryItem = {
  id: number;
  name: string;
  code?: string | null;
  [key: string]: any;
};

/** Payload that was sent to the client (returned when room loader was already sent) */
export type SentToClientPatient = {
  patientId: number;
  clientId?: number;
  clientName?: string;
  patientName?: string;
  vaccines?: { felv?: boolean; lepto?: boolean; lyme?: boolean; bordatella?: boolean; sharps?: boolean };
  questions?: { labWork?: boolean; mobility?: boolean; preMedsAsk?: boolean };
  reminders?: Array<{
    reminderId: number;
    quantity?: number;
    item?: { id: number; type: string; name: string; code?: string; price: number };
    reminderText?: string;
    reminderType?: string;
    dueDate?: string;
    confidence?: number;
  }>;
  addedItems?: Array<{ id: number; type: string; name: string; code?: string; price: number; quantity?: number }>;
  arrivalWindow?: { start: string; end: string };
  appointmentIds?: number[];
  appointmentReason?: string;
  originalAppointmentReason?: string;
  /** Notes from employee to client (e.g. explaining items); included per patient in sent-to-client payload */
  notesToClient?: string;
};

export type SentToClient = {
  practiceId?: number;
  practiceName?: string;
  sentStatus?: string;
  dueStatus?: DueStatus | null;
  patients: SentToClientPatient[];
};

export type RoomLoader = {
  id: number;
  isActive: boolean;
  isDeleted: boolean;
  pimsId?: string | null;
  pimsType: string;
  sentStatus: SentStatus;
  /** Number of times the form has been sent to the client */
  timesSentToClient?: number;
  dueStatus: DueStatus | null;
  practice: Practice;
  appointments: Appointment[];
  patients: Patient[];
  reminders?: ReminderWithPrice[];
  declinedInventoryItems?: DeclinedInventoryItem[];
  savedForm?: Record<string, any> | null;
  /** Payload that was sent to the client (when sentStatus indicates already sent) */
  sentToClient?: SentToClient | null;
  /** Token for public form/PDF URL (when form has been sent). Used for View PDF link. */
  token?: string | null;
  created?: string;
  updated?: string;
};

export type RoomLoaderSearchParams = {
  id?: number;
  practiceId?: number;
  activeOnly?: boolean;
  sentStatus?: SentStatus;
  dueStatus?: DueStatus;
};

export type CreateRoomLoaderRequest = {
  practice: { id: number };
  sentStatus?: SentStatus;
  dueStatus?: DueStatus | null;
  appointments?: Array<{ id: number }>;
  patients?: Array<{ id: number }>;
};

export type UpsertRoomLoaderRequest = CreateRoomLoaderRequest & {
  id?: number;
  pimsId?: string | null;
};

// Search room loaders
export async function searchRoomLoaders(params?: RoomLoaderSearchParams): Promise<RoomLoader[]> {
  const queryParams = new URLSearchParams();
  if (params?.id) queryParams.append('id', String(params.id));
  if (params?.practiceId) queryParams.append('practiceId', String(params.practiceId));
  if (params?.activeOnly !== undefined) queryParams.append('activeOnly', String(params.activeOnly));
  if (params?.sentStatus) queryParams.append('sentStatus', params.sentStatus);
  if (params?.dueStatus) queryParams.append('dueStatus', params.dueStatus);

  const queryString = queryParams.toString();
  const url = `/room-loader${queryString ? `?${queryString}` : ''}`;
  const { data } = await http.get<RoomLoader[]>(url);
  return data;
}

// Get single room loader by ID
export async function getRoomLoader(id: number): Promise<RoomLoader> {
  const { data } = await http.get<RoomLoader>(`/room-loader/${id}`);
  return data;
}

// Create room loader(s)
export async function createRoomLoaders(
  request: CreateRoomLoaderRequest | CreateRoomLoaderRequest[]
): Promise<RoomLoader[]> {
  const { data } = await http.post<RoomLoader[]>('/room-loader', request);
  return data;
}

// Upsert room loader(s)
export async function upsertRoomLoaders(
  request: UpsertRoomLoaderRequest | UpsertRoomLoaderRequest[]
): Promise<RoomLoader[]> {
  const { data } = await http.post<RoomLoader[]>('/room-loader/upsert', request);
  return data;
}

// Delete room loader(s)
export async function deleteRoomLoaders(ids: number[]): Promise<{ ok: boolean; deleted: number }> {
  const idsParam = ids.join(',');
  const { data } = await http.delete<{ ok: boolean; deleted: number }>(`/room-loader?ids=${idsParam}`);
  return data;
}

// Search items for room loader
export type SearchableItem = {
  itemType: 'inventory' | 'lab' | 'procedure' | 'package' | string;
  inventoryItem?: any;
  lab?: any;
  /** Set when itemType is `package` (bundle id for UI/cache; pricing uses customPrice). */
  packageId?: number;
  price: number;
  name: string;
  code?: string;
  originalPrice?: number;
  wellnessPlanPricing?: {
    hasCoverage: boolean;
    adjustedPrice: number;
    originalPrice: number;
    includedQuantity: number;
    usedQuantity: number;
    remainingQuantity: number;
    isWithinLimit: boolean;
    priceAdjustedByMembership?: boolean;
    membershipPlanName?: string;
    membershipDiscountAmount?: number;
    clientDiscounts?: Record<string, any>;
  };
  discountPricing?: {
    priceAdjustedByDiscount: boolean;
    discountAmount?: number;
    discountPercentage?: number;
    clientDiscounts?: {
      clientStatusDiscount?: {
        discount: number;
        discountType: string;
        clientStatusName?: string;
        clientStatusCode?: string;
      };
      personalDiscount?: {
        discount: number;
      };
      totalDiscountAmount?: number;
      totalDiscountPercentage?: number;
    };
  };
  tieredPricing?: {
    hasTieredPricing: boolean;
    priceBreaks?: Array<{
      lowQuantity: string;
      highQuantity: string;
      price: string;
      markup: string;
      isActive: boolean;
    }>;
  };
};

export type ItemSearchParams = {
  q: string;
  practiceId: number;
  limit?: number;
  /** If set, backend may also match items by this code (e.g. same as q to search by name or code). */
  code?: string;
};

export async function searchItems(params: ItemSearchParams): Promise<SearchableItem[]> {
  const queryParams = new URLSearchParams();
  queryParams.append('q', params.q);
  queryParams.append('practiceId', String(params.practiceId));
  if (params.limit) {
    queryParams.append('limit', String(params.limit));
  }
  if (params.code != null && params.code !== '') {
    queryParams.append('code', params.code);
  }

  const { data } = await http.get<SearchableItem[]>(`/room-loader/items/search?${queryParams.toString()}`);
  return data;
}

/** Public item search (no auth required). Used by the public room loader form. */
export async function searchItemsPublic(params: ItemSearchParams): Promise<SearchableItem[]> {
  const queryParams = new URLSearchParams();
  queryParams.append('q', params.q);
  queryParams.append('practiceId', String(params.practiceId));
  queryParams.append('limit', String(params.limit ?? 50));

  const { data } = await http.get<SearchableItem[]>(`/public/room-loader/items/search?${queryParams.toString()}`);
  return data;
}

// Submit reminder match feedback
export type ReminderMappingFeedbackRequest = {
  reminderText: string;
  reminderId?: number;
  practiceId: number;
  patientId?: number; // Optional: For patient-specific mapping
  isCorrect: boolean;
  // For confirming correct matches
  itemType?: 'lab' | 'procedure' | 'inventory';
  itemId?: number;
  // For correcting incorrect matches
  incorrectItemName?: string;
  correctItemType?: 'lab' | 'procedure' | 'inventory';
  correctItemId?: number;
  notes?: string;
};

export type ReminderItemMapping = {
  id: number;
  practice: Practice;
  normalizedReminderText: string;
  originalReminderText: string;
  itemType: 'lab' | 'procedure' | 'inventory';
  itemId: number;
  feedbackCount: number;
  correctCount: number;
  incorrectCount: number;
  lastFeedbackAt: string | null;
  isActive: boolean;
  notes: string | null;
  created: string;
  updated: string;
};

export async function submitReminderFeedback(request: ReminderMappingFeedbackRequest): Promise<ReminderItemMapping> {
  const { data } = await http.post<ReminderItemMapping>('/room-loader/reminder-matches/feedback', request);
  return data;
}

// Check item pricing for a patient. Pass the full item object (e.g. from search) so backend has all fields.
export type CheckItemPricingRequest = {
  patientId: number;
  practiceId: number;
  clientId: number;
  /** Patient species label (e.g. Canine, Feline) for membership / species-specific pricing rules. */
  species?: string;
  itemType: 'lab' | 'procedure' | 'inventory' | string;
  /** Catalog row. Omit when using `customPrice` (e.g. package lines priced as a bundle). */
  item?: {
    lab?: Record<string, unknown>;
    procedure?: Record<string, unknown>;
    inventoryItem?: Record<string, unknown>;
  };
  /** Pre-discount amount when there is no catalog row; backend applies membership/discount rules. */
  customPrice?: number;
  customName?: string;
};

export type CheckItemPricingResponse = {
  item: {
    itemType: string;
    lab?: any;
    procedure?: any;
    inventoryItem?: any;
    price: number;
    name: string;
    code?: string;
  };
  adjustedPrice: number;
  originalPrice: number;
  wellnessPlanPricing?: {
    hasCoverage: boolean;
    adjustedPrice: number;
    originalPrice: number;
    includedQuantity: number;
    usedQuantity: number;
    remainingQuantity: number;
    isWithinLimit: boolean;
  };
  discountPricing?: {
    priceAdjustedByDiscount: boolean;
    discountAmount?: number;
    discountPercentage?: number;
    clientDiscounts?: {
      clientStatusDiscount?: {
        discount: number;
        discountType: string;
        clientStatusName?: string;
        clientStatusCode?: string;
      };
      personalDiscount?: {
        discount: number;
      };
      totalDiscountAmount?: number;
      totalDiscountPercentage?: number;
    };
  };
  tieredPricing?: {
    hasTieredPricing: boolean;
    priceBreaks?: Array<{
      lowQuantity: string;
      highQuantity: string;
      price: string;
      markup: string;
      isActive: boolean;
    }>;
  };
};

export async function checkItemPricing(request: CheckItemPricingRequest): Promise<CheckItemPricingResponse> {
  const { data } = await http.post<CheckItemPricingResponse>('/room-loader/check-item-pricing', request);
  return data;
}

/** Public (client) form: get adjusted price for an item with client/membership discounts applied. Pass the full item object (e.g. from search) so backend has all fields. */
export type CheckItemPricingPublicRequest = {
  token: string;
  patientId: number;
  /** Practice ID (same as employee request). */
  practiceId?: number;
  /** Client ID (same as employee request) so backend can apply client-specific discounts. */
  clientId?: number;
  /** Patient species label (e.g. Canine, Feline) for membership / species-specific pricing rules. */
  species?: string;
  itemType: 'lab' | 'procedure' | 'inventory' | string;
  /**
   * Catalog row (lab / procedure / inventory). Omit when using `customPrice` (no catalog row, e.g. Ecwid additional item).
   */
  item?: {
    lab?: Record<string, unknown>;
    procedure?: Record<string, unknown>;
    inventoryItem?: Record<string, unknown>;
  };
  /** Pre-discount amount when there is no catalog row; backend applies membership pricing to this amount. */
  customPrice?: number;
  /** Optional label for custom line (backend default: Custom item). */
  customName?: string;
};

const CHECK_ITEM_PRICING_TTL_MS = 60 * 60 * 1000; // 1 hour
const CHECK_ITEM_PRICING_CACHE_MAX = 500;

type CheckItemPricingCacheEntry = { response: CheckItemPricingResponse; expiresAt: number };
const checkItemPricingCache = new Map<string, CheckItemPricingCacheEntry>();

function checkItemPricingCacheKey(request: CheckItemPricingPublicRequest): string {
  return JSON.stringify({
    token: request.token,
    patientId: request.patientId,
    practiceId: request.practiceId,
    clientId: request.clientId,
    species: request.species ?? null,
    itemType: request.itemType,
    item: request.item ?? null,
    customPrice: request.customPrice ?? null,
    customName: request.customName ?? null,
  });
}

/** Clears in-memory pricing cache for public check-item-pricing. Call after membership enrollment (or any change to client discount eligibility): cache keys omit membership state, so old entries would otherwise return pre-enrollment prices for up to one hour. */
export function clearCheckItemPricingPublicCache(): void {
  checkItemPricingCache.clear();
}

export async function checkItemPricingPublic(
  request: CheckItemPricingPublicRequest
): Promise<CheckItemPricingResponse> {
  const key = checkItemPricingCacheKey(request);
  const entry = checkItemPricingCache.get(key);
  const now = Date.now();
  if (entry != null && entry.expiresAt > now) {
    return entry.response;
  }
  if (entry != null) {
    checkItemPricingCache.delete(key);
  }
  const body: Record<string, unknown> = {
    token: request.token,
    patientId: request.patientId,
    itemType: request.itemType,
  };
  if (request.practiceId != null) body.practiceId = request.practiceId;
  if (request.clientId != null) body.clientId = request.clientId;
  if (request.species != null && String(request.species).trim() !== '') body.species = request.species;
  const useCustom =
    request.customPrice != null && request.customPrice !== undefined && Number.isFinite(Number(request.customPrice));
  if (useCustom) {
    body.customPrice = Number(request.customPrice);
    if (request.customName != null && String(request.customName).trim() !== '') {
      body.customName = String(request.customName).trim();
    }
  } else if (request.item != null) {
    body.item = request.item;
  }
  const { data } = await http.post<CheckItemPricingResponse>('/public/room-loader/check-item-pricing', body);
  if (checkItemPricingCache.size >= CHECK_ITEM_PRICING_CACHE_MAX) {
    const firstKey = checkItemPricingCache.keys().next().value;
    if (firstKey != null) checkItemPricingCache.delete(firstKey);
  }
  checkItemPricingCache.set(key, {
    response: data,
    expiresAt: now + CHECK_ITEM_PRICING_TTL_MS,
  });
  return data;
}

// Save form data for later
export type SaveFormRequest = {
  roomLoaderId: number;
  formData?: {
    reminders?: ReminderWithPrice[];
    [key: string]: any;
  };
};

export async function saveRoomLoaderForm(request: SaveFormRequest): Promise<RoomLoader> {
  const { data } = await http.post<RoomLoader>('/room-loader/save-form', request);
  return data;
}

// =============================================================================
// Room loader summary: membership comparison for non-members
// =============================================================================

/** One membership plan offered for a pet (species-based). Returned by GET /public/room-loader/form when client is not a member. */
export type RoomLoaderMembershipOffer = {
  planId: string;
  planName: string;
  tagLine?: string;
  /** Price in dollars per month (monthly billing). */
  monthlyPrice: number;
  /** Price in dollars for annual billing (total for the year, or first year). */
  annualPrice?: number;
  /** Whether this plan is an add-on (e.g. PLUS, Puppy/Kitten). */
  isAddOn?: boolean;
};

/** Per-patient membership offers (plans applicable to this pet's species). Returned by GET /public/room-loader/form. */
export type RoomLoaderAvailablePlansForPet = {
  patientId: number;
  patientName?: string;
  species?: string;
  /** When true, this pet is already enrolled; frontend should not upsell membership for this patient. */
  isMember?: boolean;
  membershipName?: string | null;
  plans: RoomLoaderMembershipOffer[];
};

/** Line item for simulate-bill: must include enough for backend to re-apply membership pricing (itemType + item id when available). */
export type RoomLoaderSimulateLineItem = {
  name: string;
  quantity: number;
  /** Current price (non-member) in dollars. */
  price: number;
  patientId: number;
  patientName?: string;
  category?: string;
  /** Optional: so backend can look up membership-adjusted price. */
  itemType?: 'lab' | 'procedure' | 'inventory' | string;
  /** Optional: id of procedure, lab, or inventory item. */
  itemId?: number;
};

export type RoomLoaderSimulateBillPublicRequest = {
  token: string;
  practiceId?: number;
  clientId?: number;
  /** Plan to simulate (e.g. "foundations", "golden"). */
  planId: string;
  /** When set, backend may select dog vs cat catalog entry (same as client portal). Ignored if unsupported. */
  species?: 'dog' | 'cat';
  /** Billing cadence for the plan. */
  pricingOption: 'monthly' | 'annual';
  /** Patient(s) this plan applies to (e.g. single pet for base plan). */
  patientIds: number[];
  /** Current summary line items (services/labs/products) so backend can recalc with membership. */
  lineItems: RoomLoaderSimulateLineItem[];
  /** Store/additional items subtotal and tax (optional; backend may add to total). */
  storeSubtotal?: number;
  storeTax?: number;
};

export type RoomLoaderSimulateBillPublicResponse = {
  /** Total without membership (visit services only, no store). */
  originalVisitSubtotal: number;
  /** Total without membership (visit + store + tax). */
  originalTotal: number;
  /** Visit subtotal if client had this membership (discounts applied). */
  withMembershipVisitSubtotal: number;
  /** Membership fee for this plan/cadence (e.g. first month or annual amount). */
  membershipFee: number;
  /** Total with membership: withMembershipVisitSubtotal + membershipFee + store (if any). */
  withMembershipTotal: number;
  /** originalTotal - withMembershipTotal (positive = savings). */
  savings: number;
  /** When pricingOption is monthly: first month's membership charge. Use for "due at visit" (withMembershipVisitSubtotal + monthlyCharge). */
  monthlyCharge?: number;
  /** When pricingOption is monthly: optional (e.g. annual equivalent for display). */
  monthlyMembershipFee?: number;
  /** Per-line adjustments for display (optional). */
  lineItemAdjustments?: Array<{
    name: string;
    patientId: number;
    originalPrice: number;
    adjustedPrice: number;
    quantity: number;
  }>;
  /** Plan benefits still available to the member that are not used in this visit (optional). Backend may return when simulating. */
  remainingPlanBenefits?: Array<{
    name: string;
    remainingQuantity?: number;
    includedQuantity?: number;
    /** Plan/membership price per unit (what the member pays when using this benefit). */
    price?: number;
    /** Standard (non-member) price per unit, e.g. for "Value $X". */
    regularPrice?: number;
  }>;
};

export async function simulateBillWithMembershipPublic(
  request: RoomLoaderSimulateBillPublicRequest
): Promise<RoomLoaderSimulateBillPublicResponse> {
  const { data } = await http.post<RoomLoaderSimulateBillPublicResponse>(
    '/public/room-loader/simulate-bill-with-membership',
    request
  );
  return data;
}

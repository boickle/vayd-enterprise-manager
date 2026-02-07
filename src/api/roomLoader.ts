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
  questions?: { labWork?: boolean; mobility?: boolean };
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
  itemType: 'inventory' | 'lab' | 'procedure' | string;
  inventoryItem?: any;
  lab?: any;
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
};

export async function searchItems(params: ItemSearchParams): Promise<SearchableItem[]> {
  const queryParams = new URLSearchParams();
  queryParams.append('q', params.q);
  queryParams.append('practiceId', String(params.practiceId));
  if (params.limit) {
    queryParams.append('limit', String(params.limit));
  }

  const { data } = await http.get<SearchableItem[]>(`/room-loader/items/search?${queryParams.toString()}`);
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

// Check item pricing for a patient
export type CheckItemPricingRequest = {
  patientId: number;
  practiceId: number;
  clientId: number;
  itemType: 'lab' | 'procedure' | 'inventory' | string;
  item: {
    lab?: {
      id: number;
      name: string;
      price: string;
      code?: string;
    };
    procedure?: {
      id: number;
      name: string;
      price: string;
      code?: string;
    };
    inventoryItem?: {
      id: number;
      name: string;
      price: string;
      code?: string;
    };
  };
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

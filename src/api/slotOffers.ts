import { http } from './http';

export type SendSlotOfferPayload = {
  practiceId: number;
  clientId: number;
  petIds: number[];
  doctorId: number;
  zoneId: number;
  appointmentTypeId: number;
  serviceMinutes: number;
  offeredSlotDatetime: string;
  insertionIndex: number;
  slotDate: string;
  scheduledTimeSec: number;
  arrivalWindowStart: string;
  arrivalWindowEnd: string;
  windowStartSec: number;
  windowEndSec: number;
  isFixedTimeCandidate: boolean;
  clFirstName: string;
  /** v2 routing candidate score at send time (lower = better); stored as offeredSlotScore. */
  routingScore?: number;
  /** Appointment description to apply when the client confirms. */
  bookDescription?: string;
  /** Staff notes to append on confirm (source prefix added server-side). */
  bookInstructions?: string;
  /** Per-patient type, description, and notes used when the client confirms. */
  bookVisits?: Array<{
    patientId: number;
    appointmentTypeId: number;
    description?: string;
    instructions?: string;
  }>;
  /** Drives staff-notes prefix on client confirm book. */
  createdVia?: 'care_outreach' | 'schedule_loader';
  /** When set, server sends this body (plus confirm link) instead of the default template. */
  smsBody?: string;
  /** Set true when replacing an existing pending offer for the same client. */
  confirmOverwrite?: boolean;
};

export type SendSlotOfferResponse = {
  offerId?: string;
  status?: string;
};

export type SlotOfferListTab = 'active' | 'to_confirm' | 'expired' | 'booked' | 'removed';

export type SlotOfferStatus =
  | 'pending'
  | 'expired'
  | 'accepted'
  | 'manual_review'
  | 'superseded';

export type SlotOfferListItem = {
  id: string;
  practiceId?: number;
  clientId?: number;
  clientName?: string | null;
  petIds?: number[];
  petNames?: string[];
  doctorId?: number;
  doctorName?: string | null;
  offeredSlotDatetime?: string | null;
  arrivalWindowStart?: string | null;
  arrivalWindowEnd?: string | null;
  slotDate?: string | null;
  status: SlotOfferStatus;
  attemptNumber?: number;
  sentAt?: string | null;
  respondedAt?: string | null;
  bookedAppointmentId?: number | null;
  clFirstName?: string | null;
  resolved?: boolean;
  staffConfirmedAt?: string | null;
  removedAt?: string | null;
  manualReviewReason?: string | null;
  /** E.164 or display phone the offer SMS was sent from (when API provides it). */
  smsFrom?: string | null;
  bookDescription?: string | null;
  bookInstructions?: string | null;
  createdVia?: 'care_outreach' | 'schedule_loader' | null;
  serviceMinutes?: number;
  appointmentTypeId?: number;
  appointmentTypeName?: string | null;
};

export type SlotOfferBookVisitDetail = {
  patientId: number;
  petName: string;
  appointmentTypeId: number;
  appointmentTypeName?: string | null;
  durationMinutes?: number | null;
  description?: string | null;
  instructions?: string | null;
};

export type SlotOfferDetail = SlotOfferListItem & {
  smsBody?: string | null;
  offeredSlotScore?: number | null;
  tapScore?: number | null;
  retryChain?: string[];
  bookedAppointmentId?: number | null;
  clientDeclineNote?: string | null;
  bookVisits?: SlotOfferBookVisitDetail[];
};

function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function pickNum(v: unknown): number | undefined {
  if (v == null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function pickBool(v: unknown): boolean | undefined {
  if (v == null) return undefined;
  if (typeof v === 'boolean') return v;
  if (v === 'true' || v === 1 || v === '1') return true;
  if (v === 'false' || v === 0 || v === '0') return false;
  return undefined;
}

function pickNumArray(v: unknown): number[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.map(Number).filter((n) => Number.isFinite(n));
  return out.length > 0 ? out : undefined;
}

function pickStrArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.map((x) => String(x).trim()).filter(Boolean);
  return out.length > 0 ? out : undefined;
}

function pickBookVisits(v: unknown): SlotOfferBookVisitDetail[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: SlotOfferBookVisitDetail[] = [];
  for (const row of v) {
    if (!row || typeof row !== 'object') continue;
    const raw = row as Record<string, unknown>;
    const patientId = pickNum(raw.patientId ?? raw.patient_id);
    const appointmentTypeId = pickNum(raw.appointmentTypeId ?? raw.appointment_type_id);
    if (patientId == null || appointmentTypeId == null) continue;
    out.push({
      patientId,
      petName: pickStr(raw.petName ?? raw.pet_name) ?? `Pet #${patientId}`,
      appointmentTypeId,
      appointmentTypeName: pickStr(raw.appointmentTypeName ?? raw.appointment_type_name),
      durationMinutes: pickNum(raw.durationMinutes ?? raw.duration_minutes) ?? null,
      description: pickStr(raw.description),
      instructions: pickStr(raw.instructions),
    });
  }
  return out.length > 0 ? out : undefined;
}

function normalizeSlotOfferRow(raw: Record<string, unknown>): SlotOfferListItem | null {
  const id = pickStr(raw.id ?? raw.offerId);
  if (!id) return null;
  const bookedAppointmentId = pickNum(raw.bookedAppointmentId ?? raw.booked_appointment_id);
  const statusRaw = pickStr(raw.status) ?? 'pending';
  const status = (bookedAppointmentId != null ? 'accepted' : statusRaw) as SlotOfferStatus;
  return {
    id,
    practiceId: pickNum(raw.practiceId ?? raw.practice_id),
    clientId: pickNum(raw.clientId ?? raw.client_id),
    clientName: pickStr(raw.clientName ?? raw.client_name),
    petIds: pickNumArray(raw.petIds ?? raw.pet_ids),
    petNames: pickStrArray(raw.petNames ?? raw.pet_names),
    doctorId: pickNum(raw.doctorId ?? raw.doctor_id),
    doctorName: pickStr(raw.doctorName ?? raw.doctor_name),
    offeredSlotDatetime: pickStr(raw.offeredSlotDatetime ?? raw.offered_slot_datetime),
    arrivalWindowStart: pickStr(raw.arrivalWindowStart ?? raw.arrival_window_start),
    arrivalWindowEnd: pickStr(raw.arrivalWindowEnd ?? raw.arrival_window_end),
    slotDate: pickStr(raw.slotDate ?? raw.slot_date),
    status,
    attemptNumber: pickNum(raw.attemptNumber ?? raw.attempt_number),
    sentAt: pickStr(
      raw.sentAt ?? raw.sent_at ?? raw.offeredAt ?? raw.offered_at ?? raw.createdAt ?? raw.created_at
    ),
    respondedAt: pickStr(raw.respondedAt ?? raw.responded_at),
    bookedAppointmentId,
    clFirstName: pickStr(raw.clFirstName ?? raw.cl_first_name),
    resolved: pickBool(raw.resolved),
    staffConfirmedAt: pickStr(raw.staffConfirmedAt ?? raw.staff_confirmed_at),
    removedAt: pickStr(raw.removedAt ?? raw.removed_at),
    manualReviewReason: pickStr(raw.manualReviewReason ?? raw.manual_review_reason),
    bookDescription: pickStr(raw.bookDescription ?? raw.book_description),
    bookInstructions: pickStr(raw.bookInstructions ?? raw.book_instructions),
    createdVia: (pickStr(raw.createdVia ?? raw.created_via) as SlotOfferListItem['createdVia']) ?? null,
    serviceMinutes: pickNum(raw.serviceMinutes ?? raw.service_minutes),
    appointmentTypeId: pickNum(raw.appointmentTypeId ?? raw.appointment_type_id),
    appointmentTypeName: pickStr(raw.appointmentTypeName ?? raw.appointment_type_name),
  };
}

function normalizeSlotOfferList(data: unknown): SlotOfferListItem[] {
  const rows = Array.isArray(data)
    ? data
    : Array.isArray((data as { items?: unknown })?.items)
      ? (data as { items: unknown[] }).items
      : Array.isArray((data as { offers?: unknown })?.offers)
        ? (data as { offers: unknown[] }).offers
        : [];
  const out: SlotOfferListItem[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const normalized = normalizeSlotOfferRow(row as Record<string, unknown>);
    if (normalized) out.push(normalized);
  }
  return out;
}

function normalizeSlotOfferDetail(data: unknown): SlotOfferDetail | null {
  if (!data || typeof data !== 'object') return null;
  const raw = data as Record<string, unknown>;
  const base = normalizeSlotOfferRow(raw);
  if (!base) return null;
  return {
    ...base,
    smsBody: pickStr(raw.smsBody ?? raw.sms_body),
    offeredSlotScore: pickNum(raw.offeredSlotScore ?? raw.offered_slot_score),
    tapScore: pickNum(raw.tapScore ?? raw.tap_score),
    retryChain: pickStrArray(raw.retryChain ?? raw.retry_chain),
    bookedAppointmentId: pickNum(raw.bookedAppointmentId ?? raw.booked_appointment_id),
    clientDeclineNote: pickStr(raw.clientDeclineNote ?? raw.client_decline_note),
    smsFrom: pickStr(raw.smsFrom ?? raw.sms_from),
    bookVisits: pickBookVisits(raw.bookVisits ?? raw.book_visits),
  };
}

export async function fetchSlotOffers(opts: {
  practiceId: number;
  tab: SlotOfferListTab;
}): Promise<SlotOfferListItem[]> {
  const { data } = await http.get<unknown>('/slot-offers', {
    params: { practiceId: opts.practiceId, tab: opts.tab },
  });
  return normalizeSlotOfferList(data);
}

export async function fetchSlotOfferDetail(
  offerId: string,
  practiceId: number
): Promise<SlotOfferDetail | null> {
  const { data } = await http.get<unknown>(`/slot-offers/${encodeURIComponent(offerId)}`, {
    params: { practiceId },
  });
  return normalizeSlotOfferDetail(data);
}

export type PendingSlotOfferForClient = {
  hasPending: boolean;
  offer?: {
    id: string;
    offeredAt?: string | null;
    arrivalWindowStart?: string | null;
    arrivalWindowEnd?: string | null;
    slotDate?: string | null;
    attemptNumber?: number;
  };
};

export async function fetchPendingSlotOfferForClient(opts: {
  practiceId: number;
  clientId: number;
}): Promise<PendingSlotOfferForClient> {
  const { data } = await http.get<PendingSlotOfferForClient>(
    '/slot-offers/pending-for-client',
    { params: { practiceId: opts.practiceId, clientId: opts.clientId } }
  );
  return data ?? { hasPending: false };
}

export async function resolveSlotOffer(offerId: string, practiceId: number): Promise<void> {
  await http.post(`/slot-offers/${encodeURIComponent(offerId)}/resolve`, { practiceId });
}

export async function confirmSlotOffer(offerId: string, practiceId: number): Promise<void> {
  await http.post(`/slot-offers/${encodeURIComponent(offerId)}/confirm`, { practiceId });
}

export async function removeSlotOffer(offerId: string, practiceId: number): Promise<void> {
  await http.post(`/slot-offers/${encodeURIComponent(offerId)}/remove`, { practiceId });
}

export async function sendSlotOffer(payload: SendSlotOfferPayload): Promise<SendSlotOfferResponse> {
  const { data } = await http.post<SendSlotOfferResponse>('/slot-offers/send', payload);
  return data ?? {};
}

export function formatSendSlotOfferError(err: unknown): string {
  const status = (err as { response?: { status?: number } })?.response?.status;
  const data = (err as { response?: { data?: { message?: string | { message?: string }; code?: string } } })
    ?.response?.data;
  const nestedMsg =
    typeof data?.message === 'object' && data?.message != null
      ? (data.message as { message?: string }).message
      : undefined;
  if (status === 409 && data?.code === 'PENDING_SLOT_OFFER_EXISTS') {
    return nestedMsg
      ? String(nestedMsg)
      : 'A pending texted offer already exists for this client.';
  }
  if (status === 422) {
    return 'Client opted out of SMS — manual outreach only.';
  }
  const msg = nestedMsg ?? (typeof data?.message === 'string' ? data.message : undefined) ??
    (err as Error)?.message;
  return msg ? String(msg) : 'Could not send text offer.';
}

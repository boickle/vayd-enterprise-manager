import axios from 'axios';

const baseURL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

/** No JWT — token in URL only; do not use `http` (it attaches Authorization when logged in). */
const publicSlotOfferClient = axios.create({ baseURL, withCredentials: false });

export type SlotOfferConfirmStatus =
  | 'pending'
  | 'expired'
  | 'accepted'
  | 'manual_review'
  | 'superseded'
  | 'unavailable';

export type SlotOfferConfirmPetReminder = {
  description: string;
  dueDate: string;
};

export type SlotOfferConfirmPetCareNeeds = {
  name: string;
  pastDue: SlotOfferConfirmPetReminder[];
  upcoming: SlotOfferConfirmPetReminder[];
};

export type SlotOfferConfirmResponse = {
  status: SlotOfferConfirmStatus;
  canConfirm?: boolean;
  canDecline?: boolean;
  canSubmitDeclineNote?: boolean;
  clientFirstName?: string | null;
  doctorName?: string | null;
  arrivalWindow?: { start?: string | null; end?: string | null } | null;
  pets?: string[];
  petCareNeeds?: SlotOfferConfirmPetCareNeeds[];
  declineMessage?: string | null;
  clientDeclineNote?: string | null;
  message?: string | null;
};

export type SlotOfferTapOutcome = 'accepted' | 'expired' | 'retry_sent' | 'manual_review';

export type SlotOfferTapResponse = {
  outcome: SlotOfferTapOutcome;
  message?: string | null;
};

export type SlotOfferDeclineResponse = {
  message?: string | null;
  declineMessage?: string | null;
};

export async function fetchSlotOfferConfirm(token: string): Promise<SlotOfferConfirmResponse> {
  const { data } = await publicSlotOfferClient.get<SlotOfferConfirmResponse>(
    `/public/slot-offers/confirm/${encodeURIComponent(token)}`
  );
  return data ?? { status: 'expired' };
}

export async function tapSlotOffer(token: string): Promise<SlotOfferTapResponse> {
  const { data } = await publicSlotOfferClient.post<SlotOfferTapResponse>(
    `/public/slot-offers/tap/${encodeURIComponent(token)}`
  );
  return data ?? { outcome: 'manual_review', message: 'Something went wrong. Please call us.' };
}

export async function declineSlotOffer(
  token: string,
  message: string
): Promise<SlotOfferDeclineResponse> {
  const { data } = await publicSlotOfferClient.post<SlotOfferDeclineResponse>(
    `/public/slot-offers/decline/${encodeURIComponent(token)}`,
    { message: message.trim() }
  );
  return data ?? {};
}

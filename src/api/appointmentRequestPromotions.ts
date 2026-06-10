import { http } from './http';

// ─── Types ───────────────────────────────────────────────────────────────────

export type AppointmentRequestPromotion = {
  id: number;
  companyName: string;
  name: string;
  description?: string | null;
  token: string;
  /** Human-readable promo code, e.g. VAYDH7K2MQ. Null for link-only promotions. */
  code?: string | null;
  discountType: 'fixed_amount' | 'percentage';
  amountOffCents?: number | null;
  percentOff?: number | null;
  currency: string;
  maxRedemptions?: number | null;
  timesRedeemed: number;
  expiresAt?: string | null;
  practiceId?: number | null;
  isActive: boolean;
  isDeleted: boolean;
  created: string;
  updated: string;
};

export type PublicAppointmentRequestPromotion = {
  companyName: string;
  name: string;
  description?: string | null;
  token: string;
  /** Human-readable code when resolved via the code path. */
  code?: string | null;
  discountType: 'fixed_amount' | 'percentage';
  amountOffCents?: number | null;
  percentOff?: number | null;
  currency: string;
  practiceId?: number | null;
};

export type CreateAppointmentRequestPromotionRequest = {
  companyName: string;
  name: string;
  description?: string;
  amountOffCents?: number;
  currency?: string;
  maxRedemptions?: number;
  expiresAt?: string;
  practiceId?: number;
  /** Custom code (letters/digits/dashes, 3–64 chars). Omit to create a link-only promotion. */
  code?: string;
  /** When true and no code is provided, auto-generate a readable unambiguous code. */
  generateCode?: boolean;
};

export type UpdateAppointmentRequestPromotionRequest = Partial<
  Omit<CreateAppointmentRequestPromotionRequest, 'companyName'> & {
    companyName?: string;
    isActive?: boolean;
    /** Pass empty string to clear an existing code (makes it link-only again). */
    code?: string;
    /** When true, generate and assign a fresh code. */
    generateCode?: boolean;
  }
>;

export type ListAppointmentRequestPromotionsParams = {
  companyName?: string;
  isActive?: boolean;
  practiceId?: number;
};

// ─── Admin API (authenticated) ────────────────────────────────────────────────

const BASE = '/appointment-request-promotions';

export async function fetchAppointmentRequestPromotions(
  params?: ListAppointmentRequestPromotionsParams,
): Promise<AppointmentRequestPromotion[]> {
  const { data } = await http.get(BASE, { params });
  return data as AppointmentRequestPromotion[];
}

export async function fetchAppointmentRequestPromotion(
  id: number,
): Promise<AppointmentRequestPromotion> {
  const { data } = await http.get(`${BASE}/${id}`);
  return data as AppointmentRequestPromotion;
}

export async function createAppointmentRequestPromotion(
  payload: CreateAppointmentRequestPromotionRequest,
): Promise<AppointmentRequestPromotion> {
  const { data } = await http.post(BASE, payload);
  return data as AppointmentRequestPromotion;
}

export async function updateAppointmentRequestPromotion(
  id: number,
  payload: UpdateAppointmentRequestPromotionRequest,
): Promise<AppointmentRequestPromotion> {
  const { data } = await http.patch(`${BASE}/${id}`, payload);
  return data as AppointmentRequestPromotion;
}

export async function deleteAppointmentRequestPromotion(id: number): Promise<void> {
  await http.delete(`${BASE}/${id}`);
}

// ─── Public API (no auth) ────────────────────────────────────────────────────

const PUBLIC_BASE = '/public/appointment-request-promotions';

/** Resolve a promo via its opaque URL token. */
export async function resolveAppointmentRequestPromoToken(
  token: string,
): Promise<PublicAppointmentRequestPromotion> {
  const { data } = await http.get(`${PUBLIC_BASE}/${token}`);
  return data as PublicAppointmentRequestPromotion;
}

/** Resolve a promo via its human-readable code (case-insensitive). */
export async function resolveAppointmentRequestPromoByCode(
  code: string,
): Promise<PublicAppointmentRequestPromotion> {
  const { data } = await http.get(`${PUBLIC_BASE}/code/${code.trim().toUpperCase()}`);
  return data as PublicAppointmentRequestPromotion;
}

export async function redeemAppointmentRequestPromo(
  token: string,
): Promise<PublicAppointmentRequestPromotion> {
  const { data } = await http.post(`${PUBLIC_BASE}/${token}/redeem`);
  return data as PublicAppointmentRequestPromotion;
}

export async function redeemAppointmentRequestPromoByCode(
  code: string,
): Promise<PublicAppointmentRequestPromotion> {
  const { data } = await http.post(`${PUBLIC_BASE}/code/${code.trim().toUpperCase()}/redeem`);
  return data as PublicAppointmentRequestPromotion;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export const APPOINTMENT_PROMO_QUERY_PARAM = 'promo';

export function buildAppointmentRequestPromoUrl(token: string): string {
  const base = '/client-portal/request-appointment';
  return `${window.location.origin}${base}?${APPOINTMENT_PROMO_QUERY_PARAM}=${encodeURIComponent(token)}`;
}

export function formatPromotionDiscount(promo: PublicAppointmentRequestPromotion): string {
  if (promo.discountType === 'fixed_amount' && promo.amountOffCents != null) {
    const amount = (promo.amountOffCents / 100).toFixed(2);
    const currency = (promo.currency || 'USD').toUpperCase();
    return currency === 'USD' ? `$${amount} off` : `${amount} ${currency} off`;
  }
  if (promo.discountType === 'percentage' && promo.percentOff != null) {
    return `${promo.percentOff}% off`;
  }
  return 'Discount applied';
}

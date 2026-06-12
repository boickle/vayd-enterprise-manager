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
    isDeleted?: boolean;
    /** Pass empty string to clear an existing code (makes it link-only again). */
    code?: string;
    /** When true, generate and assign a fresh code. */
    generateCode?: boolean;
  }
>;

export type ListAppointmentRequestPromotionsParams = {
  companyName?: string;
  isActive?: boolean;
  isDeleted?: boolean;
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

export type RedeemAppointmentRequestPromoRequest = {
  /** Email from the appointment form — each email can redeem a promotion only once. */
  email: string;
  /** Database client id when the user was identified as an existing client. */
  clientId?: number;
  appointmentId?: number;
};

/**
 * Redeem a promo by token. Responds 409 when this email already redeemed the
 * promotion, 400 when the overall redemption limit was hit, 404 when invalid/expired.
 */
export async function redeemAppointmentRequestPromo(
  token: string,
  payload: RedeemAppointmentRequestPromoRequest,
): Promise<PublicAppointmentRequestPromotion> {
  const { data } = await http.post(`${PUBLIC_BASE}/${token}/redeem`, payload);
  return data as PublicAppointmentRequestPromotion;
}

/** Redeem a promo by code. Same status semantics as {@link redeemAppointmentRequestPromo}. */
export async function redeemAppointmentRequestPromoByCode(
  code: string,
  payload: RedeemAppointmentRequestPromoRequest,
): Promise<PublicAppointmentRequestPromotion> {
  const { data } = await http.post(
    `${PUBLIC_BASE}/code/${code.trim().toUpperCase()}/redeem`,
    payload,
  );
  return data as PublicAppointmentRequestPromotion;
}

export type AppointmentRequestPromoEligibility = {
  eligible: boolean;
  /** e.g. "already_redeemed" when this email already used the promotion. */
  reason?: string;
};

/** Check whether an email can still redeem a promo (per-promotion, per-email). */
export async function checkAppointmentRequestPromoEligibility(
  token: string,
  email: string,
): Promise<AppointmentRequestPromoEligibility> {
  const { data } = await http.get(`${PUBLIC_BASE}/${token}/eligibility`, {
    params: { email },
  });
  return data as AppointmentRequestPromoEligibility;
}

export async function checkAppointmentRequestPromoEligibilityByCode(
  code: string,
  email: string,
): Promise<AppointmentRequestPromoEligibility> {
  const { data } = await http.get(
    `${PUBLIC_BASE}/code/${code.trim().toUpperCase()}/eligibility`,
    { params: { email } },
  );
  return data as AppointmentRequestPromoEligibility;
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

function formatPromotionAmountForApply(promo: PublicAppointmentRequestPromotion): string {
  if (promo.discountType === 'fixed_amount' && promo.amountOffCents != null) {
    const amount = promo.amountOffCents / 100;
    return amount % 1 === 0 ? `$${amount.toFixed(0)}` : `$${amount.toFixed(2)}`;
  }
  if (promo.discountType === 'percentage' && promo.percentOff != null) {
    return `${promo.percentOff}%`;
  }
  return 'your discount';
}

export function formatPromotionBannerSubtitle(
  promo: PublicAppointmentRequestPromotion,
  options?: { isExistingClient?: boolean },
): string {
  const isExistingClient = options?.isExistingClient ?? false;

  if (isExistingClient) {
    const amount = formatPromotionAmountForApply(promo);
    return `Thanks for already being a VAYD client! We will apply ${amount} to your next visit once you submit your request!`;
  }

  return (
    promo.description ||
    `${formatPromotionDiscount(promo)} on your first visit — submitted automatically with your request.`
  );
}

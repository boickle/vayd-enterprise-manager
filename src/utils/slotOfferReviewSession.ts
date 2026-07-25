/** Texted offers → scheduler review flow for client-accepted slot offers. */
export const SLOT_OFFER_REVIEW_SESSION_KEY = 'vayd:slot-offer-review-v1';

export const TEXTED_OFFERS_TO_REVIEW_PATH =
  '/schedule/scheduling-tools/texted-offers?tab=to_confirm';

export type SlotOfferReviewSessionV1 = {
  v: 1;
  offerId: string;
  bookedAppointmentId: number;
  clientLabel?: string | null;
  returnPath: string;
};

export function writeSlotOfferReviewSession(
  next: Omit<SlotOfferReviewSessionV1, 'v'>,
): void {
  if (typeof sessionStorage === 'undefined') return;
  const offerId = next.offerId?.trim();
  const bookedAppointmentId = Number(next.bookedAppointmentId);
  if (!offerId || !Number.isFinite(bookedAppointmentId) || bookedAppointmentId <= 0) return;
  const returnPath = next.returnPath?.trim() || TEXTED_OFFERS_TO_REVIEW_PATH;
  const clientLabel = next.clientLabel?.trim() || null;
  try {
    sessionStorage.setItem(
      SLOT_OFFER_REVIEW_SESSION_KEY,
      JSON.stringify({
        v: 1,
        offerId,
        bookedAppointmentId,
        clientLabel,
        returnPath,
      }),
    );
  } catch {
    /* quota */
  }
}

export function readSlotOfferReviewSession(): SlotOfferReviewSessionV1 | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(SLOT_OFFER_REVIEW_SESSION_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as SlotOfferReviewSessionV1;
    if (o?.v !== 1 || typeof o.offerId !== 'string' || !o.offerId.trim()) return null;
    const bookedAppointmentId = Number(o.bookedAppointmentId);
    if (!Number.isFinite(bookedAppointmentId) || bookedAppointmentId <= 0) return null;
    const returnPath =
      typeof o.returnPath === 'string' && o.returnPath.trim()
        ? o.returnPath.trim()
        : TEXTED_OFFERS_TO_REVIEW_PATH;
    const clientLabel =
      typeof o.clientLabel === 'string' && o.clientLabel.trim() ? o.clientLabel.trim() : null;
    return { v: 1, offerId: o.offerId.trim(), bookedAppointmentId, clientLabel, returnPath };
  } catch {
    return null;
  }
}

export function clearSlotOfferReviewSession(): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.removeItem(SLOT_OFFER_REVIEW_SESSION_KEY);
  } catch {
    /* ignore */
  }
}

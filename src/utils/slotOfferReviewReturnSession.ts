/** Scheduler → texted offers return after staff marks an offer reviewed. */
export const SLOT_OFFER_REVIEW_RETURN_KEY = 'vayd:slot-offer-review-return-v1';

export type SlotOfferReviewReturnV1 = {
  v: 1;
  offerId: string;
};

export function writeSlotOfferReviewReturnSession(offerId: string): void {
  if (typeof sessionStorage === 'undefined') return;
  const id = offerId.trim();
  if (!id) return;
  try {
    sessionStorage.setItem(SLOT_OFFER_REVIEW_RETURN_KEY, JSON.stringify({ v: 1, offerId: id }));
  } catch {
    /* quota */
  }
}

export function readSlotOfferReviewReturnSession(): SlotOfferReviewReturnV1 | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(SLOT_OFFER_REVIEW_RETURN_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as SlotOfferReviewReturnV1;
    if (o?.v !== 1 || typeof o.offerId !== 'string' || !o.offerId.trim()) return null;
    return { v: 1, offerId: o.offerId.trim() };
  } catch {
    return null;
  }
}

export function clearSlotOfferReviewReturnSession(): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.removeItem(SLOT_OFFER_REVIEW_RETURN_KEY);
  } catch {
    /* ignore */
  }
}

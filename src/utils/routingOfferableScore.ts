/**
 * Max routing score for slots offered to clients (texted offers + standard online self-schedule).
 * Lower score = better fit. Must stay aligned with vayd-api `ROUTING_OFFERABLE_MAX_SCORE`.
 */
export const ROUTING_OFFERABLE_MAX_SCORE = 175;

/** Standard (non-member) online self-schedule — same cutoff as texted offers. */
export const ONLINE_BOOKING_OFFERABLE_BASE_SCORE = ROUTING_OFFERABLE_MAX_SCORE;

/** Member elevated online self-schedule cutoff (+25 vs standard). */
export const ROUTING_OFFERABLE_MEMBER_MAX_SCORE =
  ROUTING_OFFERABLE_MAX_SCORE + 25;

export type OnlineBookingOfferTier = 'member' | 'standard';

/** True when a routing candidate score is within the client-offer cutoff. */
export function isRoutingScoreOfferable(score: unknown): boolean {
  if (score == null) return true;
  const n = Number(score);
  return Number.isFinite(n) && n <= ROUTING_OFFERABLE_MAX_SCORE;
}

export function maxOfferableScoreForTier(
  tier: OnlineBookingOfferTier | null | undefined,
): number {
  return tier === 'member'
    ? ROUTING_OFFERABLE_MEMBER_MAX_SCORE
    : ONLINE_BOOKING_OFFERABLE_BASE_SCORE;
}

export function isRoutingScoreOfferableForTier(
  score: unknown,
  tier: OnlineBookingOfferTier | null | undefined,
): boolean {
  if (score == null) return false;
  const n = Number(score);
  const max = maxOfferableScoreForTier(tier);
  return Number.isFinite(n) && n <= max;
}

export function resolveOfferableMaxScoreFromApi(data: {
  offerableMaxScore?: unknown;
  offerTier?: OnlineBookingOfferTier | null;
}): number {
  const fromApi = Number(data.offerableMaxScore);
  if (Number.isFinite(fromApi) && fromApi > 0) return fromApi;
  return maxOfferableScoreForTier(data.offerTier);
}

/** @deprecated Use {@link ROUTING_OFFERABLE_MAX_SCORE}. */
export const SELF_SCHEDULE_MAX_ROUTING_SCORE = ROUTING_OFFERABLE_MAX_SCORE;

/** @deprecated Use {@link isRoutingScoreOfferable}. */
export function isRoutingScoreEligibleForSelfSchedule(score: unknown): boolean {
  return isRoutingScoreOfferable(score);
}

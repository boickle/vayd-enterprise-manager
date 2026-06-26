/**
 * Max routing score for slots offered to clients (online self-schedule + texted offers).
 * Lower score = better fit. Must stay aligned with vayd-api `ROUTING_OFFERABLE_MAX_SCORE`.
 */
export const ROUTING_OFFERABLE_MAX_SCORE = 150;

/** True when a routing candidate score is within the client-offer cutoff. */
export function isRoutingScoreOfferable(score: unknown): boolean {
  if (score == null) return true;
  const n = Number(score);
  return Number.isFinite(n) && n <= ROUTING_OFFERABLE_MAX_SCORE;
}

/** @deprecated Use {@link ROUTING_OFFERABLE_MAX_SCORE}. */
export const SELF_SCHEDULE_MAX_ROUTING_SCORE = ROUTING_OFFERABLE_MAX_SCORE;

/** @deprecated Use {@link isRoutingScoreOfferable}. */
export function isRoutingScoreEligibleForSelfSchedule(score: unknown): boolean {
  return isRoutingScoreOfferable(score);
}

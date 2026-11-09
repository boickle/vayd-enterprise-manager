import type { Bundle } from '../api/memberships';
import { planFitsPet } from './membershipAge';
import { resolveMembershipPetKind } from './membershipSpecies';

/** Portal / room-loader plan family (foundations, golden, …). */
export type PlanFamily = 'foundations' | 'golden' | 'comfort-care' | 'starter' | 'other';

export function planFamily(plan: Bundle): PlanFamily {
  const blob = `${plan.portalSlug || ''} ${plan.tier || ''} ${plan.name || ''}`.toLowerCase();
  if (/\bstarter\b|puppy|kitten/.test(blob)) return 'starter';
  if (/\bcomfort\b/.test(blob)) return 'comfort-care';
  if (/\bgolden\b/.test(blob)) return 'golden';
  if (/\bfoundations?\b/.test(blob)) return 'foundations';
  return 'other';
}

/**
 * Same plan-age rule as MembershipSignup and the room loader: a plan is offered
 * when the pet's age is inside its range, and a plan with no ages set is offered
 * to every pet. With the age unknown, only plans with no ages set are offered.
 */
export function planAllowedForPet(plan: Bundle, ageYears: number | null | undefined): boolean {
  if (planFamily(plan) === 'comfort-care') return false;
  return planFitsPet(plan, ageYears == null ? null : ageYears * 12, null);
}

/** A plan for the pet's species (or a plan with no species set). No species known: nothing matches. */
export function planMatchesSpecies(plan: Bundle, kind: 'dog' | 'cat' | null): boolean {
  if (!kind) return false;
  const planKind =
    resolveMembershipPetKind({ species: plan.species }) ||
    resolveMembershipPetKind({ species: plan.name }) ||
    resolveMembershipPetKind({ breed: plan.name });
  if (!planKind) return true;
  return planKind === kind;
}

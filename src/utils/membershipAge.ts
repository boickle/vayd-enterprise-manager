/**
 * Last-resort Golden age, used only when no Golden membership plan has a youngest
 * age set. Practices edit that age under Settings → Memberships (`minAgeMonths`).
 * Signup, Room Loader, and post-visit enrollment should call
 * `goldenMinAgeMonthsFromPlans` first.
 */
export const MEMBERSHIP_GOLDEN_MIN_AGE_YEARS = 8;

export type PlanAgeSource = {
  name?: string | null;
  species?: string | null;
  minAgeMonths?: number | null;
};

function isGoldenPlanName(name: string | null | undefined): boolean {
  return /\bgolden\b/i.test(name || '') && !/puppy|kitten/i.test(name || '');
}

function speciesFits(planSpecies: string | null | undefined, species: 'dog' | 'cat' | null | undefined): boolean {
  if (!species) return true;
  const s = (planSpecies || '').toLowerCase();
  if (!s || s === 'any') return true;
  if (species === 'dog') return /dog|canine/.test(s);
  return /cat|feline/.test(s);
}

/**
 * Youngest age (months) at which Golden is offered, from the practice's Golden plans.
 * Null when every Golden plan has a blank youngest age — callers may then fall back
 * to `MEMBERSHIP_GOLDEN_MIN_AGE_YEARS`.
 */
export function goldenMinAgeMonthsFromPlans(
  plans: PlanAgeSource[],
  species?: 'dog' | 'cat' | null
): number | null {
  const mins = plans
    .filter((plan) => isGoldenPlanName(plan.name) && speciesFits(plan.species, species))
    .map((plan) => plan.minAgeMonths)
    .filter((months): months is number => months != null && Number.isFinite(months) && months >= 0);
  if (mins.length === 0) return null;
  return Math.min(...mins);
}

/** True when this pet is old enough for Golden, using plan ages when the practice has set them. */
export function petMeetsGoldenAge(
  ageYears: number | null | undefined,
  plans?: PlanAgeSource[] | null,
  species?: 'dog' | 'cat' | null
): boolean {
  if (ageYears == null || !Number.isFinite(ageYears)) return false;
  const fromPlans = plans?.length ? goldenMinAgeMonthsFromPlans(plans, species) : null;
  const minMonths = fromPlans ?? MEMBERSHIP_GOLDEN_MIN_AGE_YEARS * 12;
  return ageYears * 12 >= minMonths;
}

export type RecommendablePlan = PlanAgeSource & {
  maxAgeMonths?: number | null;
  sortOrder?: number | null;
};

/** Same rule as renewal: from the youngest age (inclusive) through the oldest age in whole months. */
export function planFitsPet(
  plan: RecommendablePlan,
  ageMonths: number,
  species?: 'dog' | 'cat' | null
): boolean {
  if (!speciesFits(plan.species, species)) return false;
  if (plan.minAgeMonths != null && ageMonths < plan.minAgeMonths) return false;
  if (plan.maxAgeMonths != null && Math.floor(ageMonths) > plan.maxAgeMonths) return false;
  return true;
}

/**
 * The plan to badge "Recommended" among plans that fit: the narrowest age range wins
 * (Puppy 0–1 over Foundations; Golden 8+ over Foundations with no ages), then the
 * lowest sort order.
 */
export function pickRecommendedPlan<T extends RecommendablePlan>(plans: T[]): T | null {
  const width = (p: T) =>
    p.maxAgeMonths == null ? Number.POSITIVE_INFINITY : p.maxAgeMonths - (p.minAgeMonths ?? 0);
  const sorted = [...plans].sort(
    (a, b) =>
      width(a) - width(b) ||
      (b.minAgeMonths ?? 0) - (a.minAgeMonths ?? 0) ||
      (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
  );
  return sorted[0] ?? null;
}

const MAX_REASONABLE_PARSED_AGE_YEARS = 35;

/**
 * Parse free-text age for membership (Golden, puppy/kitten add-on).
 * Date-shaped strings must be parsed as dates before stripping digits — otherwise "2021-03-15"
 * becomes a huge bogus number and incorrectly qualifies for Golden.
 */
export function parseAgeStringToYears(ageStr: string | null | undefined): number | null {
  if (ageStr == null || typeof ageStr !== 'string') return null;
  const trimmed = ageStr.trim();
  if (!trimmed) return null;
  const s = trimmed.toLowerCase();

  const numMatch = s.match(/^(\d+(?:\.\d+)?)\s*(?:y(?:ear)?s?|yr?s?)?$/);
  if (numMatch) {
    const y = parseFloat(numMatch[1]);
    if (y <= MAX_REASONABLE_PARSED_AGE_YEARS) return Math.max(0, y);
    return null;
  }

  const monthsMatch = s.match(/^(\d+)\s*mo(?:nth)?s?$/);
  if (monthsMatch) return Math.max(0, parseInt(monthsMatch[1], 10) / 12);

  const yearMonthMatch = s.match(/^(\d+)\s*y(?:ear)?s?\s*(?:and|\d*)\s*(\d+)\s*mo(?:nth)?s?$/);
  if (yearMonthMatch) {
    return Math.max(0, parseInt(yearMonthMatch[1], 10) + parseInt(yearMonthMatch[2], 10) / 12);
  }

  const asDate = new Date(trimmed);
  if (!Number.isNaN(asDate.getTime())) {
    const diff = Date.now() - asDate.getTime();
    return Math.max(0, diff / (1000 * 60 * 60 * 24 * 365.25));
  }

  const compact = s.replace(/[^\d.]/g, '');
  const justNum = parseFloat(compact);
  if (Number.isFinite(justNum) && justNum >= 0 && justNum <= MAX_REASONABLE_PARSED_AGE_YEARS) {
    return Math.max(0, justNum);
  }
  return null;
}

/**
 * Same patient source order as room-loader `getPetDetailsForMembership` (row + appointment patient).
 * Use in MembershipSignup when `modalPet` mirrors that row so Golden/starter rules match the upsell.
 */
export function computeMembershipAgeYearsForRoomLoaderRow(
  row: unknown,
  appointmentPatient?: unknown
): number | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  const ap =
    appointmentPatient && typeof appointmentPatient === 'object'
      ? (appointmentPatient as Record<string, unknown>)
      : null;
  return computeMembershipPetAgeYears(
    [r.patient, row, appointmentPatient, ap?.patient].filter(Boolean)
  );
}

/**
 * Age in years from an ordered list of patient-like objects (room-loader row, nested `patient`,
 * appointment patient, etc.). First valid DOB wins, then first parseable `age` / numeric `ageYears` /
 * `age_in_years`. Prefer `computeMembershipAgeYearsForRoomLoaderRow` for modal pets tied to a row.
 */
export function computeMembershipPetAgeYears(sources: unknown[]): number | null {
  const objs = sources.filter((x) => x != null && typeof x === 'object') as Record<string, unknown>[];

  for (const c of objs) {
    const dob = c.dob;
    if (typeof dob === 'string' && dob.trim()) {
      const d = new Date(dob.trim());
      if (!Number.isNaN(d.getTime())) {
        const diff = Date.now() - d.getTime();
        return Math.max(0, diff / (1000 * 60 * 60 * 24 * 365.25));
      }
    }
  }

  for (const c of objs) {
    if (c.age != null && String(c.age).trim()) {
      const parsed = parseAgeStringToYears(String(c.age));
      if (parsed != null) return parsed;
    }
    const y = c.ageYears ?? c.age_in_years;
    if (typeof y === 'number' && Number.isFinite(y) && y >= 0 && y <= MAX_REASONABLE_PARSED_AGE_YEARS) {
      return Math.max(0, y);
    }
  }
  return null;
}

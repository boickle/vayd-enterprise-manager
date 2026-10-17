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
 * Null when every Golden plan has a blank youngest age (Golden is then offered at any age).
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

export type RecommendablePlan = PlanAgeSource & {
  maxAgeMonths?: number | null;
  sortOrder?: number | null;
};

/**
 * Same rule as renewal: from the youngest age (inclusive) through the oldest age in whole months.
 * A plan with no ages fits every pet; with the pet's age unknown, only such plans fit.
 */
export function planFitsPet(
  plan: RecommendablePlan,
  ageMonths: number | null | undefined,
  species?: 'dog' | 'cat' | null
): boolean {
  if (!speciesFits(plan.species, species)) return false;
  if (ageMonths == null || !Number.isFinite(ageMonths)) {
    return plan.minAgeMonths == null && plan.maxAgeMonths == null;
  }
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

/** The signup card a practice plan belongs to, matched by name. */
export function membershipPlanFamily(
  name: string | null | undefined
): 'golden' | 'foundations' | null {
  if (/comfort/i.test(name || '')) return null;
  if (/\bgolden\b/i.test(name || '')) return 'golden';
  if (/foundation/i.test(name || '')) return 'foundations';
  return null;
}

/**
 * Which of the Foundations and Golden cards to offer a pet, and which to recommend.
 * Plans whose age range fits the pet decide; with no fitting plan (e.g. the plan
 * list did not load) only Foundations is offered.
 */
export function membershipCardChoice(
  plans: RecommendablePlan[],
  ageYears: number | null | undefined,
  species: 'dog' | 'cat' | null
): { foundations: boolean; golden: boolean; recommended: 'golden' | 'foundations' } {
  const ageMonths = ageYears == null ? null : ageYears * 12;
  const fitting = plans.filter(
    (plan) => membershipPlanFamily(plan.name) && planFitsPet(plan, ageMonths, species)
  );
  const families = fitting.length
    ? new Set(fitting.map((plan) => membershipPlanFamily(plan.name)))
    : null;
  const golden = families ? families.has('golden') : false;
  const foundations = families ? families.has('foundations') : true;
  const best = pickRecommendedPlan(fitting);
  const recommended =
    (best && membershipPlanFamily(best.name)) || (golden ? 'golden' : 'foundations');
  return { foundations, golden, recommended };
}

/** True when the pet's age fits one of the practice's Puppy / Kitten plans. */
export function starterPlanFitsPet(
  plans: RecommendablePlan[],
  ageYears: number | null | undefined,
  species: 'dog' | 'cat' | null
): boolean {
  if (!species) return false;
  const ageMonths = ageYears == null ? null : ageYears * 12;
  return plans.some(
    (plan) => /puppy|kitten/i.test(plan.name || '') && planFitsPet(plan, ageMonths, species)
  );
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

  const monthsMatch = s.match(/^(\d+)\s*mo(?:nth)?s?(?:\s+old)?$/);
  if (monthsMatch) return Math.max(0, parseInt(monthsMatch[1], 10) / 12);

  const weeksMatch = s.match(/^(\d+)\s*w(?:ee)?ks?(?:\s+old)?$/);
  if (weeksMatch) return Math.max(0, parseInt(weeksMatch[1], 10) / 52);

  const daysMatch = s.match(/^(\d+)\s*d(?:ay)?s?(?:\s+old)?$/);
  if (daysMatch) return Math.max(0, parseInt(daysMatch[1], 10) / 365.25);

  const fractionMatch = s.match(/^(\d+)\s+(\d)\/(\d)\s*(?:y(?:ear)?s?|yr?s?)?(?:\s+old)?$/);
  if (fractionMatch && Number(fractionMatch[3]) > 0) {
    return parseInt(fractionMatch[1], 10) + Number(fractionMatch[2]) / Number(fractionMatch[3]);
  }

  const yearMonthMatch = s.match(/^(\d+)\s*y(?:ear)?s?\s*(?:and|\d*)\s*(\d+)\s*mo(?:nth)?s?$/);
  if (yearMonthMatch) {
    return Math.max(0, parseInt(yearMonthMatch[1], 10) + parseInt(yearMonthMatch[2], 10) / 12);
  }

  const looksLikeDate =
    /\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}/.test(s) ||
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/.test(s);
  const asDate = looksLikeDate ? new Date(trimmed) : new Date(NaN);
  if (!Number.isNaN(asDate.getTime()) && asDate.getTime() <= Date.now()) {
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

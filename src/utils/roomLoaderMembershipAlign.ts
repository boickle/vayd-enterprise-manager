// src/utils/roomLoaderMembershipAlign.ts
// Keeps Room Loader lab-panel age windows honest against the plan that actually
// covers those catalog items. Pure so settings and smoke tests share one check.
import { goldenMinAgeMonthsFromPlans } from './membershipAge';
import {
  roomLoaderItemKey,
  type RoomLoaderAgeWindow,
  type RoomLoaderItemRef,
  type RoomLoaderSpecies,
} from './roomLoaderConfigTypes';
import { speciesMatches, speciesSelectionIsAll, speciesSlug } from './roomLoaderSpecies';

export type MembershipAlignFamily = 'foundations' | 'golden';

/** Minimal plan shape — enough to know who covers an item, without the HTTP client. */
export type MembershipAlignPlan = {
  id: number;
  name: string;
  species: string | null;
  minAgeMonths: number | null;
  maxAgeMonths: number | null;
  items: Array<{ itemType: string; catalogItemId: number }>;
};

export type AgeCoverageMismatch = {
  severity: 'warning';
  family: MembershipAlignFamily;
  itemName: string;
  message: string;
  /** Which snap button fixes this warning. */
  snap: MembershipAlignFamily;
};

function familyFromName(name: string): MembershipAlignFamily | null {
  const n = (name || '').toLowerCase();
  if (/\bgolden\b/.test(n)) return 'golden';
  if (/\bfoundation/.test(n)) return 'foundations';
  return null;
}

export function membershipPlanFamily(name: string): MembershipAlignFamily | null {
  return familyFromName(name);
}

export function membershipCutoffHint(): string {
  return 'Choose the membership this panel belongs with. The age window should match that plan’s youngest and oldest age under Settings → Memberships, so the pitch can mark the panel covered.';
}

export function snapAgeToPlan(
  age: RoomLoaderAgeWindow,
  plan: Pick<MembershipAlignPlan, 'minAgeMonths' | 'maxAgeMonths'>
): RoomLoaderAgeWindow {
  let minMonths = age.minMonths ?? 0;
  let maxMonths = age.maxMonths;
  if (plan.minAgeMonths != null) minMonths = plan.minAgeMonths;
  if (plan.maxAgeMonths != null) {
    maxMonths = plan.maxAgeMonths;
    if (minMonths >= plan.maxAgeMonths) minMonths = Math.min(age.minMonths ?? 0, plan.maxAgeMonths);
  }
  if (maxMonths != null && minMonths > maxMonths) minMonths = 0;
  return { minMonths, maxMonths };
}

export function formatPlanAge(plan: Pick<MembershipAlignPlan, 'name' | 'minAgeMonths' | 'maxAgeMonths'>): string {
  const from = plan.minAgeMonths != null && plan.minAgeMonths > 0 ? formatAgeBound(plan.minAgeMonths) : null;
  const to = plan.maxAgeMonths != null ? formatAgeBound(plan.maxAgeMonths) : null;
  if (!from && !to) return `${plan.name} has no youngest or oldest age set`;
  if (from && to) return `${plan.name} is for pets from ${from} up to ${to}`;
  if (to) return `${plan.name} is for pets under ${to}`;
  return `${plan.name} is for pets ${from} and older`;
}

function speciesHintsFromText(value: string | null | undefined): string[] {
  const s = (value || '').toLowerCase();
  const out: string[] = [];
  if (/\bdog|\bcanine/.test(s)) out.push('dog');
  if (/\bcat|\bfeline/.test(s)) out.push('cat');
  return out;
}

/**
 * A plan fits a rule when its species column matches, or — when that column is
 * blank — when the plan name says canine or feline. Practices often leave the
 * column empty and put the species in the name.
 */
export function planFitsRuleSpecies(
  plan: Pick<MembershipAlignPlan, 'species' | 'name'>,
  ruleSpecies: RoomLoaderSpecies | RoomLoaderSpecies[]
): boolean {
  const column = speciesSlug(plan.species);
  if (column && column !== 'any') return membershipSpeciesMatches(plan.species, ruleSpecies);
  return membershipSpeciesMatches(plan.name, ruleSpecies);
}

export function membershipSpeciesMatches(
  planSpecies: string | null,
  ruleSpecies: RoomLoaderSpecies | RoomLoaderSpecies[]
): boolean {
  if (speciesSelectionIsAll(ruleSpecies)) return true;
  const column = speciesSlug(planSpecies);
  if (column && column !== 'any' && !/\s/.test(column)) {
    return speciesMatches(ruleSpecies, column);
  }
  const hints = speciesHintsFromText(planSpecies);
  if (hints.length === 0) return true;
  return speciesMatches(ruleSpecies, hints);
}

export function plansFromBundles(
  bundles: Array<{
    id?: number | null;
    name?: string | null;
    species?: string | null;
    minAgeMonths?: number | null;
    maxAgeMonths?: number | null;
    isArchived?: boolean;
    isActive?: boolean;
    groups?: Array<{ items?: Array<{ itemType?: string; catalogItemId?: number }> }>;
  }>
): MembershipAlignPlan[] {
  const out: MembershipAlignPlan[] = [];
  for (const bundle of bundles) {
    if (bundle.isArchived) continue;
    if (bundle.isActive === false) continue;
    const name = (bundle.name || '').trim();
    if (!familyFromName(name)) continue;
    if (bundle.id == null || !Number.isFinite(bundle.id)) continue;
    out.push({
      id: bundle.id,
      name,
      species: bundle.species ?? null,
      minAgeMonths: bundle.minAgeMonths ?? null,
      maxAgeMonths: bundle.maxAgeMonths ?? null,
      items: (bundle.groups ?? []).flatMap((group) =>
        (group.items ?? [])
          .filter((item) => item.itemType && Number(item.catalogItemId) > 0)
          .map((item) => ({
            itemType: String(item.itemType),
            catalogItemId: Number(item.catalogItemId),
          }))
      ),
    });
  }
  return out;
}

export function coveringFamiliesForItem(
  ref: RoomLoaderItemRef | null | undefined,
  plans: MembershipAlignPlan[],
  ruleSpecies: RoomLoaderSpecies | RoomLoaderSpecies[]
): MembershipAlignFamily[] {
  if (!ref || ref.itemId <= 0) return [];
  const key = roomLoaderItemKey(ref);
  const found = new Set<MembershipAlignFamily>();
  for (const plan of plans) {
    const family = familyFromName(plan.name);
    if (!family) continue;
    if (!membershipSpeciesMatches(plan.species, ruleSpecies)) continue;
    const hit = plan.items.some((item) => `${item.itemType}:${item.catalogItemId}` === key);
    if (hit) found.add(family);
  }
  return [...found];
}

export function coveringPlansLabel(
  families: MembershipAlignFamily[],
  itemName: string
): string | null {
  if (families.length === 0) return null;
  const label =
    families.length === 2
      ? 'Foundations and Golden'
      : families[0] === 'golden'
        ? 'Golden'
        : 'Foundations';
  const name = itemName.trim() || 'This panel';
  return `${name} is covered by ${label}.`;
}

function formatAgeBound(months: number): string {
  if (months <= 0) return 'birth';
  if (months % 12 === 0) {
    const years = months / 12;
    return years === 1 ? '1 year' : `${years} years`;
  }
  return months === 1 ? '1 month' : `${months} months`;
}

/**
 * Warn when a panel the membership covers is asked outside the age that plan is
 * recommended — or stops short of that window. Items on no plan are left alone
 * (puppy fecal, medical-concern panels, etc.).
 */
function mismatch(
  family: MembershipAlignFamily,
  itemName: string,
  message: string
): AgeCoverageMismatch {
  return { severity: 'warning', family, itemName, message, snap: family };
}

/** Compare a Room Loader age window to the membership the practice picked for that rule. */
export function mismatchesForRule(args: {
  age: RoomLoaderAgeWindow;
  alignPackageId: number | null;
  plans: MembershipAlignPlan[];
}): AgeCoverageMismatch[] {
  if (args.alignPackageId == null) return [];
  const plan = args.plans.find((row) => row.id === args.alignPackageId);
  if (!plan) return [];
  const family = familyFromName(plan.name) ?? 'foundations';
  if (plan.minAgeMonths == null && plan.maxAgeMonths == null) {
    return [
      mismatch(
        family,
        plan.name,
        `${plan.name} has no youngest or oldest age. Set those under Settings → Memberships so this rule can stay lined up with who the plan covers.`
      ),
    ];
  }

  const min = args.age.minMonths ?? 0;
  const max = args.age.maxMonths;
  const out: AgeCoverageMismatch[] = [];
  const described = formatPlanAge(plan);

  if (plan.maxAgeMonths != null && (max == null || max > plan.maxAgeMonths)) {
    out.push(
      mismatch(
        family,
        plan.name,
        `This rule asks past ${formatAgeBound(plan.maxAgeMonths)}, but ${described}. Pets older than the plan will be offered a panel it does not cover.`
      )
    );
  } else if (plan.maxAgeMonths != null && max != null && max < plan.maxAgeMonths && max >= 12) {
    out.push(
      mismatch(
        family,
        plan.name,
        `This rule stops at ${formatAgeBound(max)}. ${described}, so pets between those ages will not be asked about a panel the plan covers.`
      )
    );
  }

  if (plan.minAgeMonths != null && min < plan.minAgeMonths) {
    out.push(
      mismatch(
        family,
        plan.name,
        `This rule starts at ${formatAgeBound(min)}, but ${described}. Younger pets will be offered a panel that plan does not cover.`
      )
    );
  } else if (plan.minAgeMonths != null && min > plan.minAgeMonths) {
    out.push(
      mismatch(
        family,
        plan.name,
        `This rule starts at ${formatAgeBound(min)}. ${described}, so pets between those ages will not be asked about a panel the plan covers.`
      )
    );
  }

  return out;
}

/**
 * Foundations should hand off to Golden at one age. Warn when the plans themselves disagree.
 */
export function membershipPlanAgeDisagreement(plans: MembershipAlignPlan[]): string | null {
  const goldenMins = [
    ...new Set(
      plans
        .filter((plan) => familyFromName(plan.name) === 'golden' && plan.minAgeMonths != null)
        .map((plan) => plan.minAgeMonths as number)
    ),
  ];
  if (goldenMins.length > 1) {
    return `Golden plans disagree on youngest age (${goldenMins.map(formatAgeBound).join(' and ')}). Set them to the same age under Settings → Memberships.`;
  }
  const foundationsMaxes = [
    ...new Set(
      plans
        .filter(
          (plan) =>
            familyFromName(plan.name) === 'foundations' &&
            !/puppy|kitten/i.test(plan.name) &&
            plan.maxAgeMonths != null
        )
        .map((plan) => plan.maxAgeMonths as number)
    ),
  ];
  const goldenMin = goldenMinAgeMonthsFromPlans(plans);
  if (goldenMin != null && foundationsMaxes.length === 1 && foundationsMaxes[0] !== goldenMin) {
    return `Foundations ends at ${formatAgeBound(foundationsMaxes[0])} and Golden starts at ${formatAgeBound(goldenMin)}. Set those to the same age under Settings → Memberships so a panel is not recommended for an age the plan does not cover.`;
  }
  return null;
}

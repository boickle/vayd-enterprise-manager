/**
 * Copy for the online-store membership tout.
 *
 * Members get a percent off their own pet's items, so a household with one member
 * and one non-member should see both halves: the discount that is already working
 * and the pet that could still get it.
 */

export type StoreMemberPromoPet = {
  id: number;
  name: string;
};

export type StoreMemberPromoInput = {
  loggedIn: boolean;
  pets: StoreMemberPromoPet[];
  /** patientId → percent off, from the member-discounts endpoint. */
  discounts: Record<number, number>;
  /** Practice's plan store percents; with none set, there is no sign-up pitch. */
  advertised: { min: number; max: number } | null;
};

export type StoreMemberPromo = {
  /** `member` is reassurance, the others invite a sign-up. */
  kind: 'join' | 'mixed' | 'member';
  percent: number;
  headline: string;
  body: string;
  /** Members already know where the portal is; non-members get the nudge. */
  showPortalLink: boolean;
};

function joinNames(names: string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return names[0]!;
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
}

/** Trim decimals that only exist because the percent is stored as numeric. */
export function formatMemberPercent(percent: number): string {
  const n = Number(percent) || 0;
  return String(Math.round(n * 100) / 100);
}

export function buildStoreMemberPromo(input: StoreMemberPromoInput): StoreMemberPromo | null {
  const pets = input.pets.filter((p) => Number.isFinite(p.id) && p.name.trim());
  const memberPets = pets.filter((p) => (input.discounts[p.id] ?? 0) > 0);
  const nonMemberPets = pets.filter((p) => !((input.discounts[p.id] ?? 0) > 0));
  const bestPercent = Math.max(0, ...pets.map((p) => input.discounts[p.id] ?? 0));
  const advertised = input.advertised;
  const percent = bestPercent > 0 ? bestPercent : advertised?.max ?? 0;
  if (percent <= 0) return null;
  const pct = formatMemberPercent(percent);
  const pitch =
    bestPercent > 0 || !advertised || advertised.min === advertised.max
      ? `${pct}%`
      : `up to ${pct}%`;

  if (!input.loggedIn || pets.length === 0) {
    return {
      kind: 'join',
      percent,
      headline: `Members save ${pitch} on the online store`,
      body: 'Membership also covers routine care, exams, and more. Check your client portal for what is included.',
      showPortalLink: true,
    };
  }

  if (memberPets.length === 0) {
    return {
      kind: 'join',
      percent,
      headline: `Members save ${pitch} on the online store`,
      body: `${joinNames(nonMemberPets.map((p) => p.name))} ${
        nonMemberPets.length === 1 ? 'is not' : 'are not'
      } on a membership yet. Members also get routine care covered — check your client portal for what is included.`,
      showPortalLink: true,
    };
  }

  if (nonMemberPets.length > 0) {
    return {
      kind: 'mixed',
      percent,
      headline: `${joinNames(memberPets.map((p) => p.name))} saves ${pct}% on this order`,
      body: `Member pricing applies per pet, so it comes off ${
        memberPets.length === 1 ? 'their' : 'those'
      } items only. Add ${joinNames(
        nonMemberPets.map((p) => p.name)
      )} to a membership to save ${pct}% on ${
        nonMemberPets.length === 1 ? 'their' : 'their'
      } items too.`,
      showPortalLink: true,
    };
  }

  return {
    kind: 'member',
    percent,
    headline: `Your ${pct}% member discount is applied`,
    body: `${joinNames(
      memberPets.map((p) => p.name)
    )} ${memberPets.length === 1 ? 'is a member' : 'are members'}, so ${pct}% comes off at checkout.`,
    showPortalLink: false,
  };
}

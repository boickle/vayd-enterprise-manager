/**
 * Golden vs Foundations (membership) and senior screen vs early detection (public room loader labs)
 * both use this age for dogs and cats. Change here only so they stay aligned.
 */
export const MEMBERSHIP_GOLDEN_MIN_AGE_YEARS = 8;

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

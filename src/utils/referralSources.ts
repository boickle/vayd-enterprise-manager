/** "How did they hear about us?": one list for Add client and Household defaults (owner, Nov 13, 2026). */
export const REFERRAL_OPTIONS = [
  'Referred by a friend or family',
  'Google / online search',
  'Social media',
  'Saw our van',
  'Veterinarian referral',
  'Other',
] as const;

/** A value saved before the list (eVet or free text) that isn't one of the options; shown so nothing is lost. */
export function legacyReferral(value: string | null | undefined): string | null {
  const v = value?.trim();
  if (!v) return null;
  return (REFERRAL_OPTIONS as readonly string[]).includes(v) || v.startsWith('Other: ') ? null : v;
}

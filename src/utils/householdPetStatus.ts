/** Shared helpers for household pet inactivation / loss notes in AI source text. */

export type HouseholdPetStatusInput = {
  id: string;
  name: string;
  active: boolean;
  /** Scout status name (Euthanized, Deceased, …). */
  statusName?: string | null;
  /** ISO timestamp when the pet became inactive. */
  inactiveAt?: string | null;
  /** Display name of who inactivated (euthanasia provider, etc.). */
  inactivatedByName?: string | null;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function employeeDisplayName(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const first = typeof o.firstName === 'string' ? o.firstName.trim() : '';
  const last = typeof o.lastName === 'string' ? o.lastName.trim() : '';
  const name = [first, last].filter(Boolean).join(' ').trim();
  if (name) return name;
  if (typeof o.name === 'string' && o.name.trim()) return o.name.trim();
  return null;
}

export function inactiveAtIso(raw: unknown): string | null {
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  if (raw && typeof raw === 'object' && 'toISO' in (raw as object)) {
    try {
      const iso = (raw as { toISO?: () => string | null }).toISO?.();
      return iso?.trim() || null;
    } catch {
      return null;
    }
  }
  return null;
}

export function statusNameFromPatient(p: Record<string, unknown>): string | null {
  const nested = p.patientStatus;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    const name = (nested as Record<string, unknown>).name;
    if (typeof name === 'string' && name.trim()) return name.trim();
  }
  if (typeof p.patientStatusName === 'string' && p.patientStatusName.trim()) {
    return p.patientStatusName.trim();
  }
  if (typeof p.status === 'string' && p.status.trim()) {
    const s = p.status.trim();
    if (!/^active$/i.test(s) && !/^inactive$/i.test(s)) return s;
  }
  return null;
}

/** One-line inactivation facts for household / case-history AI source. */
export function formatPetInactivationLine(pet: HouseholdPetStatusInput): string | null {
  if (pet.active) return null;
  const status = pet.statusName?.trim() || 'Inactive';
  const when = pet.inactiveAt?.slice(0, 10) || null;
  const who = pet.inactivatedByName?.trim() || null;
  const parts = [status];
  if (when) parts.push(`as of ${when}`);
  if (who) parts.push(`by ${who}`);
  return parts.join(' · ');
}

/**
 * Other household pets that became inactive / deceased within `months` of `asOfDate`.
 * Excludes the current patient.
 */
export function householdLossesWithinMonths(
  pets: HouseholdPetStatusInput[],
  opts: { currentPatientId: string; asOfDate: string; months?: number }
): HouseholdPetStatusInput[] {
  const months = opts.months ?? 18;
  const asOfMs = Date.parse(`${opts.asOfDate}T23:59:59`) || Date.now();
  const cutoffMs = asOfMs - months * 30.4375 * MS_PER_DAY;
  const currentId = String(opts.currentPatientId);

  return pets.filter((pet) => {
    if (String(pet.id) === currentId) return false;
    if (pet.active) return false;
    const inactiveMs = pet.inactiveAt ? Date.parse(pet.inactiveAt) : NaN;
    if (!Number.isFinite(inactiveMs)) {
      // Unknown date — still include when status suggests death / euthanasia so AI can note it.
      const status = (pet.statusName ?? '').toLowerCase();
      return /euthan|deceas|died|passed|hbc/.test(status);
    }
    return inactiveMs >= cutoffMs && inactiveMs <= asOfMs;
  });
}

export function formatHouseholdLossesSection(
  losses: HouseholdPetStatusInput[],
  months = 18
): string[] {
  if (losses.length === 0) return [];
  const lines = [
    `Household losses (last ${months} months — other pets in this household only):`,
  ];
  for (const pet of losses) {
    const detail = formatPetInactivationLine(pet) ?? 'Inactive';
    lines.push(`- ${pet.name}: ${detail}`);
  }
  return lines;
}

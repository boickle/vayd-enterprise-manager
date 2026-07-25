/** DB `patients.id` values for selected existing pets (online booking member tier). */

type PetWithDbId = {
  id?: string;
  dbId?: string | number;
};

function parsePatientDbId(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    return Math.round(raw);
  }
  if (typeof raw === 'string') {
    const parsed = parseInt(raw.trim(), 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return null;
}

/**
 * Selected existing pets only — new pets (no dbId) are omitted so they count as non-member.
 */
export function selectedPatientDbIdsFromForm(args: {
  selectedPetIds?: readonly string[];
  pets?: readonly PetWithDbId[];
}): number[] {
  const selected = args.selectedPetIds ?? [];
  if (selected.length === 0) return [];

  const dbIdByPetKey = new Map<string, number>();
  for (const pet of args.pets ?? []) {
    const key = pet.id?.trim();
    if (!key) continue;
    const dbId = parsePatientDbId(pet.dbId);
    if (dbId != null) dbIdByPetKey.set(key, dbId);
  }

  const out = new Set<number>();
  for (const petId of selected) {
    const trimmed = petId.trim();
    if (!trimmed) continue;
    const mapped = dbIdByPetKey.get(trimmed);
    if (mapped != null) {
      out.add(mapped);
    }
  }
  return Array.from(out);
}

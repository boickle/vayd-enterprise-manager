import { hasSpecialHandlingNeeds, type PetHandlingFields } from '../components/PetHandlingNeedsPicker';

function asHandlingPet(value: unknown): PetHandlingFields | null {
  if (!value || typeof value !== 'object') return null;
  return value as PetHandlingFields;
}

function isNewPatientPetId(id: unknown): boolean {
  const raw = String(id ?? '').toLowerCase();
  return raw.includes('existing-new-pet') || raw.includes('new-client-pet');
}

function isHandlingYes(value: unknown): boolean {
  return String(value ?? '').trim().toLowerCase() === 'yes';
}

/**
 * True when a new patient on the request answered Yes to calming meds, muzzle,
 * or extra handling. Mirrors API `requestHasNewPatientSpecialHandlingNeeds`.
 */
export function requestDataHasNewPatientSpecialHandlingNeeds(
  requestData: Record<string, unknown>,
): boolean {
  if (
    isHandlingYes(requestData.needsCalmingMedications) ||
    isHandlingYes(requestData.needsMuzzleOrSpecialHandling) ||
    isHandlingYes(requestData.needsExtraHandling)
  ) {
    return true;
  }

  for (const key of ['newClientPets', 'existingClientNewPets'] as const) {
    const arr = requestData[key];
    if (!Array.isArray(arr)) continue;
    for (const raw of arr) {
      const pet = asHandlingPet(raw);
      if (pet && hasSpecialHandlingNeeds(pet)) return true;
    }
  }

  const pets = requestData.pets;
  if (Array.isArray(pets)) {
    for (const raw of pets) {
      const pet = asHandlingPet(raw);
      if (!pet) continue;
      if (
        isHandlingYes((pet as { needsMuzzleOrSpecialHandling?: unknown }).needsMuzzleOrSpecialHandling) ||
        isHandlingYes((pet as { needsExtraHandling?: unknown }).needsExtraHandling)
      ) {
        return true;
      }
      const id = (raw as { id?: unknown }).id;
      if (isNewPatientPetId(id) && hasSpecialHandlingNeeds(pet)) return true;
    }
  }

  return false;
}

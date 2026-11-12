// src/utils/appointmentRequestHouseholdPets.ts
import type { NewClientSpeciesChoice } from '../components/NewClientSpeciesPicker';

/**
 * A pet listed under "Other pets at home" on the appointment request form:
 * kept on file for the account, no visit requested. Lives outside
 * newClientPets / existingClientNewPets so visit length, cost and appointment
 * type logic never count it.
 */
export type HouseholdPet = {
  id: string;
  name: string;
  speciesChoice: NewClientSpeciesChoice | '';
  species: string;
  speciesId?: number;
  otherSpecies?: string;
  age?: string;
};

export type HouseholdPetPayload = {
  id: string;
  name: string;
  species: string;
  speciesId?: number;
  age?: string;
};

export function createEmptyHouseholdPet(): HouseholdPet {
  return {
    id: `household-pet-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
    name: '',
    speciesChoice: '',
    species: '',
  };
}

/** A card the client opened but never filled in. Ignored for validation and submit. */
export function isBlankHouseholdPet(pet: HouseholdPet): boolean {
  return !pet.name.trim() && !pet.speciesChoice && !pet.age?.trim() && !pet.otherSpecies?.trim();
}

export function validateHouseholdPets(
  answer: 'Yes' | 'No' | '' | undefined,
  pets: HouseholdPet[] | undefined
): Record<string, string> {
  const errors: Record<string, string> = {};
  if (answer !== 'Yes' && answer !== 'No') {
    errors.hasOtherPetsAtHome = 'Please let us know if you have other pets at home';
    return errors;
  }
  if (answer === 'No') return errors;
  const filled = (pets ?? []).filter((p) => !isBlankHouseholdPet(p));
  if (filled.length === 0) {
    errors.hasOtherPetsAtHome = 'Please add your other pet, or choose No';
    return errors;
  }
  for (const pet of filled) {
    if (!pet.name.trim()) errors[`householdPet.${pet.id}.name`] = 'Pet name is required';
    if (!pet.speciesChoice) errors[`householdPet.${pet.id}.species`] = 'Species is required';
  }
  return errors;
}

/** Submit payload: only when the client answered Yes, blank cards dropped. */
export function householdPetsPayload(
  answer: 'Yes' | 'No' | '' | undefined,
  pets: HouseholdPet[] | undefined
): HouseholdPetPayload[] | undefined {
  if (answer !== 'Yes') return undefined;
  const out = (pets ?? [])
    .filter((p) => !isBlankHouseholdPet(p) && p.name.trim())
    .map((p) => {
      const species =
        p.speciesChoice === 'Other'
          ? p.otherSpecies?.trim() || 'Other'
          : p.species || p.speciesChoice;
      return {
        id: p.id,
        name: p.name.trim(),
        species: species || 'Unknown',
        ...(p.speciesId != null ? { speciesId: p.speciesId } : {}),
        ...(p.age?.trim() ? { age: p.age.trim() } : {}),
      };
    });
  return out.length > 0 ? out : undefined;
}

/** Staff-facing one-liner: "Max (Dog, 5 years), Luna (Cat)". */
export function formatHouseholdPetsSummary(raw: unknown): string | null {
  if (!Array.isArray(raw)) return null;
  const lines = raw
    .map((p) => {
      if (!p || typeof p !== 'object') return null;
      const rec = p as Record<string, unknown>;
      const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
      const name = str(rec.name);
      if (!name) return null;
      const details = [str(rec.species), str(rec.age)].filter(Boolean);
      return details.length > 0 ? `${name} (${details.join(', ')})` : name;
    })
    .filter((s): s is string => !!s);
  return lines.length > 0 ? lines.join(', ') : null;
}

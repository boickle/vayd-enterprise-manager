/**
 * Detect abandoned "add another pet" stubs on the appointment request form.
 * Clients often tap + Add a new pet, then leave the card blank / uncheck it —
 * those should never be submitted or shown as NEW PATIENT.
 */
export type AppointmentRequestNewPetLike = {
  id?: string;
  name?: string | null;
  species?: string | null;
  speciesChoice?: string | null;
  breed?: string | null;
  sex?: string | null;
  age?: string | number | null;
  color?: string | null;
  weight?: string | number | null;
};

function hasText(v: unknown): boolean {
  return typeof v === 'string' ? v.trim().length > 0 : v != null && String(v).trim().length > 0;
}

/** True when the pet row has essentially no identity / demographics filled in. */
export function isAbandonedAppointmentRequestPetStub(
  pet: AppointmentRequestNewPetLike | null | undefined,
): boolean {
  if (!pet || typeof pet !== 'object') return true;
  return !(
    hasText(pet.name) ||
    hasText(pet.species) ||
    hasText(pet.speciesChoice) ||
    hasText(pet.breed) ||
    hasText(pet.sex) ||
    hasText(pet.age) ||
    hasText(pet.color) ||
    hasText(pet.weight)
  );
}

export function filterCompletedAppointmentRequestPets<T extends AppointmentRequestNewPetLike>(
  pets: readonly T[] | null | undefined,
): T[] {
  if (!pets?.length) return [];
  return pets.filter((p) => !isAbandonedAppointmentRequestPetStub(p));
}

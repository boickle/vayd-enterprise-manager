/** The household's pets as the ledger and estimates offer them. */
export type FinancialPetLike = {
  id: number;
  name: string;
  isActive?: boolean;
  statusName?: string | null;
};

/** False for an inactive pet, or one whose status says it died or was euthanized. */
export function isFinancialPetActive(pet: FinancialPetLike): boolean {
  if (pet.isActive === false) return false;
  const status = (pet.statusName ?? '').toLowerCase();
  return !/euthan|deceas|died|passed|inactive/.test(status);
}

export function sortPetsForCharge<T extends FinancialPetLike>(pets: T[]): T[] {
  return [...pets].sort((a, b) => a.name.localeCompare(b.name));
}

/** Active pets unless Use inactive is on. A line already on an inactive pet keeps that pet. */
export function petsForChargeSelect<T extends FinancialPetLike>(
  pets: T[],
  includeInactive: boolean,
  keepId?: number | null,
): T[] {
  const rows = includeInactive
    ? pets
    : pets.filter((p) => isFinancialPetActive(p) || (keepId != null && p.id === keepId));
  return sortPetsForCharge(rows);
}

/**
 * The pets an estimate offers: active ones only (Wave 8, bug 8c), plus any pet the estimate is
 * already for, so its lines keep their pet.
 */
export function estimatePetChoices<T extends FinancialPetLike>(pets: T[], keepIds: number[] = []): T[] {
  const keep = new Set(keepIds);
  return sortPetsForCharge(pets.filter((p) => isFinancialPetActive(p) || keep.has(p.id)));
}

export type ClientDeactivationPet = { patientId: number; patientName: string };

export type KeptPet = ClientDeactivationPet & { otherOwnerNames: string[] };

function ownerName(raw: Record<string, unknown>): string {
  const name = [raw.firstName, raw.lastName]
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter(Boolean)
    .join(' ');
  return name || `Client #${raw.id}`;
}

/** Other owners of the pet who stay active after this client is deactivated. */
export function otherActiveOwnerNames(patient: unknown, clientId: number): string[] {
  const clients = (patient as { clients?: unknown } | null)?.clients;
  if (!Array.isArray(clients)) return [];
  return clients
    .filter((row): row is Record<string, unknown> => row != null && typeof row === 'object')
    .filter(
      (row) =>
        Number(row.id) !== Number(clientId) &&
        row.isActive !== false &&
        row.isDeleted !== true,
    )
    .map(ownerName);
}

/**
 * Pets shared with another active owner stay active, and so do their memberships.
 * `details` is each pet's GET /patients/:id body, keyed by patient id.
 */
export function splitPetsForClientDeactivation(
  pets: readonly ClientDeactivationPet[],
  details: ReadonlyMap<number, unknown>,
  clientId: number,
): { inactivate: ClientDeactivationPet[]; keep: KeptPet[] } {
  const inactivate: ClientDeactivationPet[] = [];
  const keep: KeptPet[] = [];
  for (const pet of pets) {
    const others = otherActiveOwnerNames(details.get(pet.patientId), clientId);
    if (others.length > 0) keep.push({ ...pet, otherOwnerNames: others });
    else inactivate.push(pet);
  }
  return { inactivate, keep };
}

export function keptPetsSentence(keep: readonly KeptPet[]): string {
  if (keep.length === 0) return '';
  return keep
    .map(
      (pet) =>
        `${pet.patientName} stays active with ${pet.otherOwnerNames.join(' and ')}, and keeps any membership.`,
    )
    .join(' ');
}

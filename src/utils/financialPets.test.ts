/**
 * Wave 8 (bug 8c): the estimate's pet list offers only pets the family has now, not inactive or
 * deceased ones, the same rule the ledger's charge picker uses. A pet already on the estimate stays.
 */
import { describe, expect, it } from 'vitest';
import { estimatePetChoices } from './financialPets';

const pets = [
  { id: 1, name: 'Maple', isActive: true, statusName: 'Active' },
  { id: 2, name: 'Pepper', isActive: false, statusName: 'Inactive' },
  { id: 3, name: 'Juniper', isActive: true, statusName: 'Active' },
  { id: 4, name: 'Olive', isActive: true, statusName: 'Deceased' },
];

describe('estimatePetChoices', () => {
  it('leaves out inactive and deceased pets, sorted by name', () => {
    expect(estimatePetChoices(pets).map((p) => p.name)).toEqual(['Juniper', 'Maple']);
  });
  it('keeps a pet the estimate is already for', () => {
    expect(estimatePetChoices(pets, [2]).map((p) => p.name)).toEqual(['Juniper', 'Maple', 'Pepper']);
  });
});

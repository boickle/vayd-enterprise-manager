import { describe, expect, it } from 'vitest';
import {
  formatHouseholdPetsSummary,
  householdPetsPayload,
  validateHouseholdPets,
  type HouseholdPet,
} from './appointmentRequestHouseholdPets';

const pet = (overrides: Partial<HouseholdPet>): HouseholdPet => ({
  id: 'h1',
  name: '',
  speciesChoice: '',
  species: '',
  ...overrides,
});

describe('validateHouseholdPets', () => {
  it('requires the yes/no answer', () => {
    expect(validateHouseholdPets('', [])).toHaveProperty('hasOtherPetsAtHome');
    expect(validateHouseholdPets('No', [])).toEqual({});
  });

  it('requires at least one filled pet when Yes', () => {
    expect(validateHouseholdPets('Yes', [pet({})])).toHaveProperty('hasOtherPetsAtHome');
  });

  it('requires name and species on filled pets only', () => {
    const errors = validateHouseholdPets('Yes', [pet({ id: 'a', name: 'Max' }), pet({ id: 'b' })]);
    expect(errors).toEqual({ 'householdPet.a.species': 'Species is required' });
  });
});

describe('householdPetsPayload', () => {
  it('sends nothing unless the answer is Yes', () => {
    expect(
      householdPetsPayload('No', [pet({ name: 'Max', speciesChoice: 'Dog', species: 'Canine' })])
    ).toBeUndefined();
  });

  it('drops blanks, trims, and uses the typed species for Other', () => {
    expect(
      householdPetsPayload('Yes', [
        pet({
          id: 'a',
          name: ' Max ',
          speciesChoice: 'Dog',
          species: 'Canine',
          speciesId: 1,
          age: '5',
        }),
        pet({
          id: 'b',
          name: 'Pip',
          speciesChoice: 'Other',
          species: 'Other',
          otherSpecies: 'Rabbit',
        }),
        pet({ id: 'c' }),
      ])
    ).toEqual([
      { id: 'a', name: 'Max', species: 'Canine', speciesId: 1, age: '5' },
      { id: 'b', name: 'Pip', species: 'Rabbit' },
    ]);
  });
});

describe('formatHouseholdPetsSummary', () => {
  it('formats stored request data for staff', () => {
    expect(
      formatHouseholdPetsSummary([
        { name: 'Max', species: 'Dog', age: '5 years' },
        { name: 'Luna', species: 'Cat' },
        { name: '' },
      ])
    ).toBe('Max (Dog, 5 years), Luna (Cat)');
    expect(formatHouseholdPetsSummary(undefined)).toBeNull();
  });
});

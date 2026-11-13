import { describe, expect, it } from 'vitest';
import { petMergeDetails } from './BriefMergePanel';

describe('petMergeDetails (CP-T1: tell two charts apart)', () => {
  it('shows species, breed, sex, birth year, chip tail and ID', () => {
    expect(
      petMergeDetails({
        id: 8581,
        species: 'Canine',
        breed: 'Golden Retriever',
        sex: 'Male',
        dob: '2017-09-01T12:00:00Z',
        microchip: '985112009876543',
      }),
    ).toBe('Canine · Golden Retriever · Male · born 2017 · chip …6543 · ID 8581');
  });
  it('says when there is no microchip', () => {
    expect(petMergeDetails({ id: 8585, species: 'Canine' })).toBe('Canine · no microchip · ID 8585');
  });
});

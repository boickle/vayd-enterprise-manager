import { describe, expect, it } from 'vitest';
import { requestDataHasNewPatientSpecialHandlingNeeds } from './appointmentRequestHandlingNeeds';

describe('requestDataHasNewPatientSpecialHandlingNeeds', () => {
  it('detects Yes on newClientPets', () => {
    expect(
      requestDataHasNewPatientSpecialHandlingNeeds({
        newClientPets: [{ needsCalmingMedications: 'Yes' }],
      }),
    ).toBe(true);
  });

  it('detects Yes on existingClientNewPets', () => {
    expect(
      requestDataHasNewPatientSpecialHandlingNeeds({
        existingClientNewPets: [{ needsExtraHandling: 'Yes' }],
      }),
    ).toBe(true);
  });

  it('ignores calming-only answers on existing chart pets', () => {
    expect(
      requestDataHasNewPatientSpecialHandlingNeeds({
        pets: [{ id: '98765', needsCalmingMedications: 'Yes' }],
      }),
    ).toBe(false);
  });

  it('detects muzzle on pets[] even without a new-pet id', () => {
    expect(
      requestDataHasNewPatientSpecialHandlingNeeds({
        pets: [{ id: '123', needsMuzzleOrSpecialHandling: 'Yes' }],
      }),
    ).toBe(true);
  });
});

import { describe, expect, it, vi } from 'vitest';

vi.mock('../api/http', () => ({ http: { get: vi.fn(), post: vi.fn() } }));
vi.mock('./practiceIdFromToken', () => ({
  currentPracticeId: () => 1,
  resolvePracticeIdFromToken: () => 1,
}));

import {
  applyKindDefaults,
  applyRabiesSource,
  type PatientDocDraft,
  type PatientDocSource,
} from './patientDocuments';

/** Only the fields the rabies helpers read; the rest of the draft is irrelevant here. */
const draft = (): PatientDocDraft =>
  ({
    tagNumber: '',
    vaccinationDate: '',
    serialNumber: '',
    expirationDate: '',
    vaccinationName: '',
    manufacturer: '',
    vaccineType: '',
    weight: '',
    veterinarianName: '',
    veterinarianLicense: '',
    veterinarianEmployeeId: null,
    veterinarianSignaturePng: null,
  }) as unknown as PatientDocDraft;

// Dr. Odile Brackenridge's license number was A when the dose was given, and is B today.
const LICENSE_AT_DOSE = 'WI-VET-A-1001';
const LICENSE_TODAY = 'WI-VET-B-2002';

const rabiesLog = {
  id: 77,
  vaccineName: 'Rabies 3yr',
  dateVaccinated: '2025-04-02T15:00:00.000Z',
  nextVaccinationDate: '2028-04-02T15:00:00.000Z',
  tagNumber: 'R-3311',
  veterinarianName: 'Odile Brackenridge',
  veterinarianLicense: LICENSE_AT_DOSE,
  employee: { id: 12, firstName: 'Odile', lastName: 'Brackenridge', licenseNumber: LICENSE_TODAY, isActive: true, isLicensed: true, licenseType: 'veterinarian' },
};

const source = (providers: PatientDocSource['providers']): PatientDocSource => ({
  rabiesLogs: [rabiesLog],
  providers,
  signatures: {},
  primaryProviderId: null,
});

describe('EMR-07-2b: the rabies certificate keeps the license in force when the dose was given', () => {
  it('prints license A from the dose, not the vet’s current license B (vet in the provider list)', () => {
    const src = source([{ id: 12, label: 'Odile Brackenridge, DVM', license: LICENSE_TODAY, active: true, isVeterinarian: true }]);
    const next = applyRabiesSource(draft(), src, '77');
    expect(next.veterinarianEmployeeId).toBe(12);
    expect(next.veterinarianName).toBe('Odile Brackenridge, DVM');
    expect(next.veterinarianLicense).toBe(LICENSE_AT_DOSE);
    // Opening the rabies certificate picks the same dose and license.
    expect(applyKindDefaults('rabies', draft(), src).veterinarianLicense).toBe(LICENSE_AT_DOSE);
  });

  it('prints license A when the vet is not in the provider list either', () => {
    const next = applyRabiesSource(draft(), source([]), '77');
    expect(next.veterinarianLicense).toBe(LICENSE_AT_DOSE);
  });

  it('falls back to the vet’s current license when the dose saved none (older records)', () => {
    const src: PatientDocSource = {
      ...source([{ id: 12, label: 'Odile Brackenridge, DVM', license: LICENSE_TODAY, active: true, isVeterinarian: true }]),
      rabiesLogs: [{ ...rabiesLog, veterinarianLicense: null }],
    };
    expect(applyRabiesSource(draft(), src, '77').veterinarianLicense).toBe(LICENSE_TODAY);
  });
});

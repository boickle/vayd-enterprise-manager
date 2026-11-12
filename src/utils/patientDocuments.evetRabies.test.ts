import { describe, expect, it, vi } from 'vitest';

vi.mock('../api/http', () => ({ http: { get: vi.fn(), post: vi.fn() } }));
vi.mock('./practiceIdFromToken', () => ({
  currentPracticeId: () => 1,
  resolvePracticeIdFromToken: () => 1,
}));

import {
  applyKindDefaults,
  applyRabiesSource,
  signerChoices,
  type PatientDocDraft,
  type PatientDocSource,
} from './patientDocuments';

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

/**
 * An imported eVet rabies dose as /patients/:id/vaccination-logs returns it: no vaccineName, no
 * veterinarianName / veterinarianLicense on the dose, no serialNumber / vaccineType. The vaccine name is on
 * treatmentItem.inventoryItem and the vet is the linked employee.
 */
const evetRabies = {
  id: 5001,
  vaccineName: null,
  veterinarianName: null,
  veterinarianLicense: null,
  serialNumber: null,
  vaccineType: null,
  lotNumber: 'RB-LOT-4471',
  tagNumber: 'TAG-90210',
  manufacturer: 'Zoetis',
  dateVaccinated: '2025-04-02T15:00:00.000Z',
  nextVaccinationDate: '2028-04-02T15:00:00.000Z',
  vaccineExpiration: '2027-04-02T00:00:00.000Z',
  usdaLicensingMonths: 36,
  treatmentItem: { inventoryItem: { name: 'Rabies 3yr Vaccine' } },
  employee: { id: 12, firstName: 'Odile', lastName: 'Brackenridge', licenseNumber: 'WI-VET-0717', isActive: true, isLicensed: true, licenseType: 'veterinarian' },
};

const src = (providers: PatientDocSource['providers'], log: Record<string, unknown> = evetRabies): PatientDocSource => ({
  rabiesLogs: [log],
  providers,
  signatures: {},
  primaryProviderId: null,
});

describe('EMR-A12-1: an imported eVet rabies dose reprints with everything on it', () => {
  it('fills vaccine, lot, tag, dates and the vet name and license from the linked employee', () => {
    const s = src([{ id: 12, label: 'Odile Brackenridge, DVM', license: 'WI-VET-0717', active: true, isVeterinarian: true }]);
    const next = applyKindDefaults('rabies', draft(), s);
    expect(next.vaccinationName).toBe('Rabies 3yr Vaccine');
    expect(next.serialNumber).toBe('RB-LOT-4471');
    expect(next.tagNumber).toBe('TAG-90210');
    expect(next.manufacturer).toBe('Zoetis');
    expect(next.vaccinationDate).toBe('2025-04-02');
    expect(next.expirationDate).toBe('2028-04-02');
    expect(next.veterinarianName).toBe('Odile Brackenridge, DVM');
    expect(next.veterinarianLicense).toBe('WI-VET-0717');
  });

  it('still prints the vet and license when the vet is not in the provider list', () => {
    const next = applyRabiesSource(draft(), src([]), '5001');
    expect(next.veterinarianName).toBe('Odile Brackenridge');
    expect(next.veterinarianLicense).toBe('WI-VET-0717');
  });
});

describe('Only a licensed veterinarian signs a prescription, rabies certificate or health certificate', () => {
  const vet = { id: 12, label: 'Odile Brackenridge, DVM', license: 'WI-VET-0717', active: true, isVeterinarian: true };
  const tech = { id: 30, label: 'Remy Tate, CVT', license: 'WI-CVT-0042', active: true, isVeterinarian: false };

  it('lists only vets for rx, rabies and health; anyone licensed for other documents', () => {
    for (const kind of ['rx', 'rabies', 'health'] as const) {
      expect(signerChoices(kind, [vet, tech]).map((p) => p.id), kind).toEqual([12]);
    }
    expect(signerChoices('death', [vet, tech]).map((p) => p.id)).toEqual([12, 30]);
  });

  it('does not default a prescription to a primary provider who is a technician', () => {
    const next = applyKindDefaults('rx', draft(), { ...src([vet, tech]), primaryProviderId: 30 });
    expect(next.veterinarianEmployeeId).toBeNull();
  });

  it('leaves the rabies signer blank when a technician gave the dose', () => {
    const log = { ...evetRabies, employee: { id: 30, firstName: 'Remy', lastName: 'Tate', isActive: true, isLicensed: true, licenseType: 'technician' } };
    const next = applyRabiesSource(draft(), src([vet, tech], log), '5001');
    expect(next.veterinarianEmployeeId).toBeNull();
    expect(next.veterinarianName).toBe('');
  });
});

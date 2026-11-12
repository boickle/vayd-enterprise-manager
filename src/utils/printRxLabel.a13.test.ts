import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api/http', () => ({ http: { get: vi.fn(), post: vi.fn() } }));
vi.mock('./practiceIdFromToken', () => ({
  currentPracticeId: () => 1,
  resolvePracticeIdFromToken: () => 1,
}));
vi.mock('../api/appointmentSettings', () => ({
  fetchEmployee: vi.fn(async () => ({
    id: 12, firstName: 'Odile', lastName: 'Brackenridge', licenseNumber: 'WI-VET-0717',
  })),
}));
vi.mock('../api/recordHistory', () => ({ recordRxLabelPrinted: vi.fn(async () => undefined) }));
vi.mock('./practiceLetterhead', () => ({
  loadPracticeLetterhead: vi.fn(async () => ({
    name: 'Birchwood Mobile Vets', address: '12 Alder Lane, Madison WI', phone: '608-555-0142', logoDataUrl: 'data:logo',
  })),
  loadProviderSignature: vi.fn(async () => 'data:sig'),
}));
const printed = vi.hoisted(() => ({ label: null as Record<string, unknown> | null }));
vi.mock('./dymoPrescriptionLabel', () => ({
  DIRECTIONS_MAX_LINES: 6,
  directionsFitsLabel: () => true,
  listDymoPrinters: vi.fn(async () => [{ name: 'DYMO 450', modelName: 'LabelWriter 450', isConnected: true }]),
  printMailOrderBagLabel: vi.fn(),
  printPrescriptionLabel: vi.fn(async (_p: string, label: Record<string, unknown>) => {
    printed.label = label;
  }),
}));

import { printRxLabelDirect } from './printRxLabel';

beforeEach(() => {
  printed.label = null;
  window.localStorage.clear();
});

describe('EMR-A13-3: the Rx label carries every required field', () => {
  it('fills practice, pet, owner, drug, directions, refills, dates, Rx number and vet', async () => {
    await printRxLabelDirect({
      patientName: 'Pippin', species: 'Canine', ownerName: 'Wren Fairweather',
      providerEmployeeId: 12, quantity: 30, name: 'Carprofen', strength: '25 mg',
      instructions: 'Give one tablet by mouth twice daily with food.', refill: 2,
      refillExpiration: '', startDate: '2026-11-02', discardAfter: '2027-11-02',
      acuity: 'chronic', existingRxNumber: 10456,
    });
    expect(printed.label).toMatchObject({
      practiceName: 'Birchwood Mobile Vets',
      practiceAddress: '12 Alder Lane, Madison WI',
      practicePhone: '608-555-0142',
      patientName: 'Pippin',
      species: 'Canine',
      ownerName: 'Wren Fairweather',
      prescriptionNumber: '10456',
      prescribedDate: '11/2/2026',
      drugName: 'Carprofen',
      strength: '25 mg',
      quantity: '30',
      instructions: 'Give one tablet by mouth twice daily with food.',
      refills: '2',
      discardAfter: '11/2/2027',
      veterinarianName: 'Dr. Odile Brackenridge',
      veterinarianLicense: 'WI-VET-0717',
      veterinarianSignaturePng: 'data:sig',
      practiceLogoPng: 'data:logo',
    });
  });
});

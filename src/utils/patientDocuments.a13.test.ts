import { describe, expect, it, vi } from 'vitest';

vi.mock('../api/http', () => ({ http: { get: vi.fn(), post: vi.fn() } }));
vi.mock('./practiceIdFromToken', () => ({
  currentPracticeId: () => 1,
  resolvePracticeIdFromToken: () => 1,
}));

const drawn = vi.hoisted(() => [] as string[]);

/** A stand-in for jsPDF that records every string a certificate draws. */
vi.mock('jspdf', () => {
  class FakePdf {
    internal = { pageSize: { getWidth: () => 612, getHeight: () => 792 } };
    text(t: unknown) {
      drawn.push(...(Array.isArray(t) ? t.map(String) : [String(t)]));
      return this;
    }
    splitTextToSize(t: string) {
      return String(t).split('\n');
    }
    constructor() {
      return new Proxy(this, {
        get: (target, prop) =>
          prop in target ? (target as never)[prop] : () => target,
      });
    }
  }
  return { default: FakePdf };
});

import {
  generatePatientDocumentPdf,
  type PatientDocDraft,
  type PatientDocKind,
} from './patientDocuments';

/** Every string a certificate draws, in order. Invented patient and people only. */
async function printedText(kind: PatientDocKind, draft: PatientDocDraft): Promise<string> {
  drawn.length = 0;
  await generatePatientDocumentPdf(kind, draft, {
    name: 'Birchwood Mobile Vets',
    address: '12 Alder Lane, Madison WI',
    phone: '608-555-0142',
    logoDataUrl: null,
  } as never);
  return drawn.join('\n');
}

const base = (): PatientDocDraft =>
  ({
    clientId: '4411',
    clientName: 'Wren Fairweather',
    address: '9 Quill Road\nMadison WI 53703',
    phone: '608-555-0199',
    patientId: '9021',
    patientName: 'Pippin',
    species: 'Canine',
    breed: 'Beagle',
    sex: 'Male neutered',
    color: 'Tricolor',
    birthday: '2018-03-04',
    birthdayDisplay: '8 years',
    weight: '24 lb',
    microchip: '985112003344556',
    tagNumber: 'R-3311',
    vaccinationDate: '2026-04-02',
    serialNumber: 'LOT-77A',
    expirationDate: '2029-04-02',
    vaccinationName: 'Rabies 3yr',
    manufacturer: 'Zoetis',
    vaccineType: 'Killed',
    veterinarianName: 'Odile Brackenridge, DVM',
    veterinarianLicense: 'WI-VET-0717',
    veterinarianEmployeeId: 12,
    veterinarianSignaturePng: null,
    rxCompoundingReason: '',
    vaccineRows: [
      { included: true, name: 'DHPP', date: '2026-04-02', expires: '2027-04-02', lot: 'L-DHPP-9' },
      { included: true, name: 'Rabies 3yr', date: '2026-04-02', expires: '2029-04-02', lot: 'LOT-77A' },
    ],
    rxName: 'Carprofen',
    rxStrength: '25 mg',
    rxInstructions: 'Give one tablet by mouth twice daily with food.',
    rxQuantity: '30',
    rxRefills: '2',
    rxDate: '2026-11-02',
    rxNumber: '10456',
    dateOfDeath: '2026-10-30',
    causeOfDeath: 'Kidney failure',
    mannerOfDeath: 'Euthanasia',
    procedureName: 'Neuter',
    surgeryDate: '2020-02-02',
    examDate: '2026-11-01',
    healthStatement: '',
    vaccinePlanKind: '',
    vaccinePlanDates: [],
    vaccinePlanRows: [],
    vaccinePlanNote: '',
  }) as unknown as PatientDocDraft;

const COMMON = ['Wren Fairweather', 'Pippin', 'Birchwood Mobile Vets', '608-555-0199'];
const SIGNED = ['Odile Brackenridge, DVM', 'WI-VET-0717'];

describe('EMR-A13-3: certificates print every required field', () => {
  it('rabies certificate', async () => {
    const text = await printedText('rabies', base());
    for (const f of [
      ...COMMON, ...SIGNED, '4411', '9021', '9 Quill Road, Madison WI 53703', 'Canine', 'Beagle',
      'Male neutered', 'Tricolor', '8 years', '24 lb', '985112003344556', 'Rabies 3yr', 'Zoetis',
      'Killed', 'LOT-77A', 'R-3311',
    ]) expect(text, f).toContain(f);
    expect(text).toMatch(/\b4\/2\/2026/); // date given
    expect(text).toMatch(/\b4\/2\/2029/); // expires
  });

  it('vaccination certificate', async () => {
    const text = await printedText('vaccination', base());
    for (const f of [...COMMON, ...SIGNED.slice(1), 'DHPP', 'L-DHPP-9', 'LOT-77A', 'Beagle', '985112003344556'])
      expect(text, f).toContain(f);
    expect(text).toContain('Administered by Odile Brackenridge, DVM');
  });

  it('health certificate', async () => {
    const text = await printedText('health', base());
    for (const f of [...COMMON, ...SIGNED, 'Canine Beagle', '985112003344556', 'DHPP', 'Rabies 3yr', '24 lb'])
      expect(text, f).toContain(f);
    expect(text).toMatch(/\b11\/1\/2026/); // exam date
  });

  it('death certificate', async () => {
    const text = await printedText('death', base());
    for (const f of [...COMMON, ...SIGNED, 'Kidney failure', 'Euthanasia', 'Beagle', 'Tricolor', '985112003344556'])
      expect(text, f).toContain(f);
    expect(text).toMatch(/\b10\/30\/2026/);
  });

  it('prescription form', async () => {
    const text = await printedText('rx', base());
    for (const f of [...COMMON, ...SIGNED, 'Carprofen', '25 mg', 'Quantity: 30', 'twice daily with food', 'Refills: 2', 'Beagle'])
      expect(text, f).toContain(f);
  });

  it('prescription form prints pharmacist notes and a typed-in DEA number', async () => {
    const text = await printedText('rx', {
      ...base(),
      rxPharmacistNotes: 'OK to substitute generic.',
      rxDeaNumber: 'AB1234563',
    });
    expect(text).toContain('Notes to pharmacist: OK to substitute generic.');
    expect(text).toContain('DEA # AB1234563');
  });

  it('prescription form leaves out the DEA line when none is typed', async () => {
    const text = await printedText('rx', base());
    expect(text).not.toContain('DEA #');
    expect(text).not.toContain('Notes to pharmacist');
  });
});

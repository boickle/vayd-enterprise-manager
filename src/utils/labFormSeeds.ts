import type { UpsertLabFormTemplate } from '../api/inHouseLabs';
import type { LabFormElement } from './labValues';

/**
 * The stock in-house lab forms, matching what staff used in the old PIMS.
 *
 * Seeds are matched on `seedKey`. "Add missing standard forms" only adds a seed
 * the practice doesn't have yet; a form that already exists is never changed.
 * Anything staff add themselves has no seedKey and is never touched.
 */

export const IN_HOUSE_CATEGORY = 'In-house lab work';

/** Snap-test row: reads Negative/Positive and flags the positive. */
function snap(name: string): LabFormElement {
  return {
    key: '',
    name,
    valueType: 'select',
    min: null,
    max: null,
    units: null,
    options: ['Negative', 'Positive'],
    abnormalOptions: ['Positive'],
    defaultValue: 'Negative',
  };
}

/**
 * Numeric row. No reference range and no default: a range would flag (or print
 * on a record) the same way for dogs and cats, and a default would be saved as a
 * real result if staff clicked Save without typing (LAB-06, LAB-05).
 */
function numeric(name: string, units: string | null): LabFormElement {
  return {
    key: '',
    name,
    valueType: 'number',
    min: null,
    max: null,
    units,
  };
}

function freeText(name: string): LabFormElement {
  return { key: '', name, valueType: 'text', min: null, max: null, units: null };
}

/** Shared dipstick pad rows, reused by the plain and with-sediment forms. */
const URINE_DIPSTICK_PADS: LabFormElement[] = [
  numeric('Urobilinogen', 'mg/dl'),
  numeric('Protein', 'mg/dl'),
  numeric('pH', 'pH'),
  numeric('Blood', null),
  numeric('Ketone', 'mg/dl'),
  numeric('Bilirubin', null),
  numeric('Glucose', 'mg/dl'),
];

export const LAB_FORM_SEEDS: UpsertLabFormTemplate[] = [
  {
    seedKey: 'blood_glucose',
    name: 'BLOOD GLUCOSE',
    category: IN_HOUSE_CATEGORY,
    mode: 'analytes',
    sortOrder: 10,
    elements: [numeric('BLOOD GLUCOSE', 'mg/dl')],
  },
  {
    seedKey: 'ear_cytology',
    name: 'Ear Cytology',
    category: IN_HOUSE_CATEGORY,
    mode: 'analytes',
    sortOrder: 20,
    elements: [freeText('Which ear?'), freeText('Description:')],
  },
  {
    seedKey: 'fluorescein_stain',
    name: 'Fluorescein Stain',
    category: IN_HOUSE_CATEGORY,
    mode: 'analytes',
    sortOrder: 30,
    description: 'Corneal stain uptake. Positive means the stain took up.',
    elements: [
      { ...snap('OD'), options: ['Negative', 'Positive'] },
      { ...snap('OS'), options: ['Negative', 'Positive'] },
    ],
  },
  {
    seedKey: 'heartworm_4dx_plus',
    name: 'HEARTWORM 4DX PLUS',
    category: IN_HOUSE_CATEGORY,
    mode: 'analytes',
    sortOrder: 40,
    elements: [
      snap('Heartworm'),
      snap('E. canis'),
      snap('E. ewingii'),
      snap('B. burgdorferi'),
      snap('Anaplasma spp'),
    ],
  },
  {
    seedKey: 'schirmer_tear_test',
    name: 'Schirmer Tear Test',
    category: IN_HOUSE_CATEGORY,
    mode: 'analytes',
    sortOrder: 50,
    elements: [numeric('OD', null), numeric('OS', null)],
  },
  {
    seedKey: 'urinalysis',
    name: 'Urinalysis',
    category: IN_HOUSE_CATEGORY,
    mode: 'summary',
    sortOrder: 60,
    elements: [],
  },
  {
    seedKey: 'urine_dipstick',
    name: 'Urine Dipstick',
    category: IN_HOUSE_CATEGORY,
    mode: 'analytes',
    sortOrder: 70,
    elements: URINE_DIPSTICK_PADS,
  },
  {
    seedKey: 'urine_dipstick_sediment',
    name: 'Urine Dipstick with Sediment',
    category: IN_HOUSE_CATEGORY,
    mode: 'analytes',
    sortOrder: 80,
    description: 'Dipstick pads plus what was seen on the spun sediment.',
    elements: [
      ...URINE_DIPSTICK_PADS,
      freeText('WBC / hpf'),
      freeText('RBC / hpf'),
      freeText('Epithelial cells'),
      freeText('Casts'),
      freeText('Crystals'),
      freeText('Bacteria'),
    ],
  },
  {
    seedKey: 'vaginal_cytology',
    name: 'Vaginal Cytology',
    category: IN_HOUSE_CATEGORY,
    mode: 'analytes',
    sortOrder: 90,
    elements: [
      numeric('Parabasal cells', '%'),
      numeric('Intermediate cells', '%'),
      numeric('Superficial cells', '%'),
      numeric('Anuclear squamous cells', '%'),
      freeText('Neutrophils'),
      freeText('Bacteria'),
      freeText('Stage'),
    ],
  },
];

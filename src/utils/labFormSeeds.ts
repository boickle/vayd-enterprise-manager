import type { UpsertLabFormTemplate } from '../api/inHouseLabs';
import type { LabFormElement } from './labValues';

/**
 * The stock in-house lab forms, matching what staff used in the old PIMS.
 *
 * Seeds are matched on `seedKey`, so installing them twice refreshes the stock
 * forms instead of duplicating them. Anything staff add themselves has no
 * seedKey and is never touched.
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

function numeric(
  name: string,
  min: number | null,
  max: number | null,
  units: string | null,
  defaultValue?: string
): LabFormElement {
  return {
    key: '',
    name,
    valueType: 'number',
    min,
    max,
    units,
    ...(defaultValue != null ? { defaultValue } : {}),
  };
}

function freeText(name: string): LabFormElement {
  return { key: '', name, valueType: 'text', min: null, max: null, units: null };
}

/** Shared dipstick pad rows, reused by the plain and with-sediment forms. */
const URINE_DIPSTICK_PADS: LabFormElement[] = [
  numeric('Urobilinogen', 0.2, 8, 'mg/dl', '0.2'),
  numeric('Protein', 0, 2000, 'mg/dl', '0'),
  numeric('pH', 5, 8.5, 'pH', '5'),
  numeric('Blood', 0, 6, null, '0'),
  numeric('Ketone', 0, 160, 'mg/dl', '0'),
  numeric('Bilirubin', 0, 4, null, '0'),
  numeric('Glucose', 0, 2000, 'mg/dl', '0'),
];

export const LAB_FORM_SEEDS: UpsertLabFormTemplate[] = [
  {
    seedKey: 'blood_glucose',
    name: 'BLOOD GLUCOSE',
    category: IN_HOUSE_CATEGORY,
    mode: 'analytes',
    sortOrder: 10,
    elements: [numeric('BLOOD GLUCOSE', 0, 500, 'mg/dl', '0')],
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
    elements: [numeric('OD', 0, 30, null, '0'), numeric('OS', 0, 30, null, '0')],
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
      numeric('Parabasal cells', 0, 100, '%'),
      numeric('Intermediate cells', 0, 100, '%'),
      numeric('Superficial cells', 0, 100, '%'),
      numeric('Anuclear squamous cells', 0, 100, '%'),
      freeText('Neutrophils'),
      freeText('Bacteria'),
      freeText('Stage'),
    ],
  },
];

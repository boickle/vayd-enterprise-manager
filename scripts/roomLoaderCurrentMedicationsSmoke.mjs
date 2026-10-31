/**
 * Smoke: client room loader check-in (first page per pet) includes an optional
 * "What medications is {Pet} on currently" field below general wellbeing,
 * and wires it into formAnswersForPdf + allowed submit keys.
 *
 * Request (internal-scout 1792769565.330479).
 *
 * Run: node scripts/roomLoaderCurrentMedicationsSmoke.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'src/pages/PublicRoomLoaderForm.tsx'), 'utf8');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(
  src.includes('What medications is {petName} on currently'),
  'UI label for current medications missing'
);
assert(
  src.includes('What medications is ${petName} on currently'),
  'PDF formAnswers question for current medications missing'
);
assert(
  src.includes("initialFormData[`${petKey}_currentMedications`] = ''"),
  'currentMedications not initialized in form defaults'
);
assert(
  src.includes("formData[`${petKey}_currentMedications`]"),
  'UI textarea not bound to currentMedications'
);
assert(
  /suffix === 'generalWellbeing'[\s\S]*?suffix === 'currentMedications'/.test(src) ||
    src.includes("suffix === 'currentMedications'") ||
    /staticCheckInSuffixes = new Set\(\[[\s\S]*?'currentMedications'[\s\S]*?\]\)/.test(src),
  'currentMedications not allowed on submit filter'
);

const wellbeingIdx = src.indexOf(
  "How is {petName} doing otherwise? Are there any other concerns you'd like us to address during this visit?"
);
const medsIdx = src.indexOf('What medications is {petName} on currently');
assert(wellbeingIdx > 0 && medsIdx > wellbeingIdx, 'medications question must appear below general wellbeing in UI');

const pdfWellbeingIdx = src.indexOf(
  "How is ${petName} doing otherwise? Are there any other concerns you'd like us to address during this visit?"
);
const pdfMedsIdx = src.indexOf('What medications is ${petName} on currently');
assert(
  pdfWellbeingIdx > 0 && pdfMedsIdx > pdfWellbeingIdx,
  'medications question must appear below general wellbeing in PDF answers'
);

console.log('roomLoaderCurrentMedicationsSmoke: ok');

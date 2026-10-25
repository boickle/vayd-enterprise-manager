/**
 * Smoke: Holds board patient name must deep-link to eVet when patient.pimsId
 * is present, matching appointment requests / waitlist / forward booking.
 *
 * Repro (#bugs-scout): "on the holds list, can we have the patient name be
 * clickable to open the chart like we can in other places?"
 *
 * Run: node scripts/holdsPatientEvetNameLinkSmoke.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const listPath = path.join(root, 'src/components/HoldPatientSummaryList.tsx');
const apiPath = path.join(root, 'src/api/holds.ts');
const list = fs.readFileSync(listPath, 'utf8');
const api = fs.readFileSync(apiPath, 'utf8');

assert(/EvetNameLink/.test(list), 'HoldPatientSummaryList must use EvetNameLink');
assert(/evetPatientLink/.test(list), 'HoldPatientSummaryList must use evetPatientLink');
assert(
  /patient\.pimsId|patientPimsId/.test(list),
  'HoldPatientSummaryList must read patient.pimsId for the eVet name link'
);
assert(
  /Open patient in eVet/.test(list),
  'Name link title must match other boards (Open patient in eVet)'
);
assert(
  /label="View details"/.test(list),
  'Scout chart summary via View details must remain'
);
assert(
  /patient:\s*\{\s*id:\s*number;\s*name:\s*string\s*\|\s*null;\s*pimsId:\s*string\s*\|\s*null\s*\}/.test(
    api
  ),
  'HoldListItem.patient must include pimsId for eVet deep links'
);

console.log('holdsPatientEvetNameLinkSmoke: ok');

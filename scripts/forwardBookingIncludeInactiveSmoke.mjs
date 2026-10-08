/**
 * Smoke: Add forward booking must offer Include inactive so staff can find
 * inactive/deceased patients (ash drop-offs).
 *
 * Repro (internal-scout): forward booking patient search used activeOnly:true
 * with no checkbox; inactive pets could not be selected for ash drop-offs.
 *
 * Run: node scripts/forwardBookingIncludeInactiveSmoke.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const modalPath = path.join(root, 'src/components/CreateForwardBookingModal.tsx');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const src = fs.readFileSync(modalPath, 'utf8');

assert(
  /includeInactive/.test(src),
  'CreateForwardBookingModal must track includeInactive state'
);
assert(
  /Include inactive/.test(src),
  'CreateForwardBookingModal must show Include inactive checkbox label'
);
assert(
  /activeOnly:\s*!includeInactive/.test(src),
  'Patient search must use activeOnly: !includeInactive'
);
assert(
  !/searchPatientsStaff\(\s*q,\s*\{\s*practiceId,\s*activeOnly:\s*true\s*\}\s*\)/.test(src),
  'Must not hardcode activeOnly: true on patient search'
);
assert(
  /includeInactivePatient:\s*true/.test(src),
  'Visit load must pass includeInactivePatient when Include inactive is on'
);
assert(
  /\(inactive\)/.test(src),
  'Inactive search hits should be labeled (inactive)'
);

console.log('forwardBookingIncludeInactiveSmoke: ok');

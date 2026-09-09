/**
 * Smoke: new-patient / new-client Practice calendar card marker
 * (thread #internal-scout 1788958590.005019 — Deirdre approved mockup).
 *
 * Cards keep visit-type color and add dark border + horizontal white hatch
 * when API marks new patient and/or new client.
 *
 * Run: node scripts/newPatientApptCardMarkerSmoke.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/** Mirror of truthyApiFlag + appointmentShowsNewPatientCardMarker (blocks skipped). */
function truthyApiFlag(v) {
  if (v === true || v === 1) return true;
  if (typeof v === 'string') {
    const t = v.trim().toLowerCase();
    return t === 'true' || t === '1' || t === 'yes';
  }
  return false;
}

function recordShowsNewClientOrPatient(row) {
  if (!row) return false;
  return (
    truthyApiFlag(row.isNewPatientAtBooking) ||
    truthyApiFlag(row.isNewClientAtBooking) ||
    truthyApiFlag(row.newPatientAtBooking) ||
    truthyApiFlag(row.newClientAtBooking) ||
    truthyApiFlag(row.isNewPatient) ||
    truthyApiFlag(row.isNewClient)
  );
}

function showsMarker(a) {
  if (a?.isPersonalBlock === true || a?.isBlock === true || a?.type === 'block') return false;
  if (recordShowsNewClientOrPatient(a)) return true;
  if (recordShowsNewClientOrPatient(a?.client)) return true;
  const patients = Array.isArray(a?.patients)
    ? a.patients
    : a?.patient
      ? [a.patient]
      : [];
  return patients.some((p) => recordShowsNewClientOrPatient(p));
}

assert(!showsMarker({ id: 1, patient: { id: 1, name: 'Bella' } }), 'existing patient: no marker');
assert(
  showsMarker({ id: 2, isNewPatientAtBooking: true, patient: { id: 2, name: 'Milo' } }),
  'top-level isNewPatientAtBooking',
);
assert(
  showsMarker({ id: 3, isNewClientAtBooking: true, client: { id: 9, firstName: 'A', lastName: 'B' } }),
  'top-level isNewClientAtBooking',
);
assert(
  showsMarker({ id: 4, patient: { id: 4, name: 'Nova', isNewPatient: true } }),
  'nested patient.isNewPatient',
);
assert(
  showsMarker({ id: 5, client: { id: 5, isNewClient: true } }),
  'nested client.isNewClient',
);
assert(
  !showsMarker({ id: 6, isPersonalBlock: true, isNewPatientAtBooking: true }),
  'personal blocks never get the marker',
);

const utilSrc = fs.readFileSync(
  path.join(root, 'src/utils/schedulerNewPatientCardMarker.ts'),
  'utf8',
);
const cssSrc = fs.readFileSync(path.join(root, 'src/pages/Scheduler.css'), 'utf8');
const schedulerSrc = fs.readFileSync(path.join(root, 'src/pages/Scheduler.tsx'), 'utf8');

assert(
  /export function appointmentShowsNewPatientCardMarker/.test(utilSrc),
  'helper must be exported',
);
assert(
  /isNewPatientAtBooking/.test(utilSrc) && /isNewClientAtBooking/.test(utilSrc),
  'helper must read both new-patient and new-client booking flags',
);
assert(
  /\.scheduler-event--new-patient/.test(cssSrc) &&
    /\.scheduler-all-day-span-bar--new-patient/.test(cssSrc),
  'CSS must define timed + all-day marker classes',
);
assert(
  /repeating-linear-gradient\(\s*0deg/.test(cssSrc.replace(/\s+/g, ' ')),
  'hatch must be horizontal (0deg), not diagonal like drive',
);
assert(
  /appointmentShowsNewPatientCardMarker/.test(schedulerSrc),
  'Scheduler must call the helper',
);
assert(
  /scheduler-event--new-patient/.test(schedulerSrc) &&
    /scheduler-all-day-span-bar--new-patient/.test(schedulerSrc),
  'Scheduler must apply marker classes on timed + all-day cards',
);
assert(
  /data-new-patient-marker/.test(schedulerSrc),
  'Scheduler should set data-new-patient-marker for inspection',
);

console.log('newPatientApptCardMarkerSmoke: ok');

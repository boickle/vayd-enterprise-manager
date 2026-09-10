/**
 * Smoke: patient/client Appointments "When" opens schedule focus
 * (same deep-link pattern as Appointment Search → View appointment).
 *
 * Repro (bugs-scout thread 1789043606.969379): blue date/time on patient
 * Appointments opened details only; staff expected jump to that day/week.
 *
 * Run: node scripts/patientAppointmentsOpenOnScheduleSmoke.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const focusSrc = fs.readFileSync(
  path.join(root, 'src/utils/schedulerFocusAppointment.ts'),
  'utf8',
);
const sectionSrc = fs.readFileSync(
  path.join(root, 'src/components/pims/PimsAppointmentsSection.tsx'),
  'utf8',
);
const searchSrc = fs.readFileSync(
  path.join(root, 'src/components/pims/AppointmentSearchHistory.tsx'),
  'utf8',
);

assert(
  /export function schedulerFocusHintsFromAppointment/.test(focusSrc),
  'must export schedulerFocusHintsFromAppointment',
);
assert(
  /export function navigateToSchedulerFocusedAppointment/.test(focusSrc),
  'must export navigateToSchedulerFocusedAppointment',
);
assert(
  /writeSchedulerFocusSession/.test(focusSrc) &&
    /buildSchedulerFocusAppointmentUrl/.test(focusSrc),
  'navigate helper must write session + build focus URL',
);
assert(
  /appointmentPracticeDateKey/.test(focusSrc),
  'hints must use practice-local date key',
);

assert(
  /navigateToSchedulerFocusedAppointment/.test(sectionSrc),
  'PimsAppointmentsSection must use shared schedule-focus navigate',
);
assert(
  /Open this appointment on the schedule/.test(sectionSrc),
  'When button title should describe schedule navigation',
);
assert(
  /onClick=\{\(\) => openOnSchedule\(a\)\}/.test(sectionSrc),
  'When click must open on schedule',
);
assert(
  /onClick=\{\(\) => setDetail\(a\)\}/.test(sectionSrc),
  'Details button must still open the detail modal',
);
assert(
  /Open on schedule/.test(sectionSrc) && /onOpenOnSchedule/.test(sectionSrc),
  'detail modal must offer Open on schedule',
);
assert(
  !/onClick=\{\(\) => setDetail\(a\)\}[\s\S]*formatApptRange/.test(
    sectionSrc.replace(/\s+/g, ' '),
  ) || /openOnSchedule\(a\)/.test(sectionSrc),
  'When must not be details-only',
);

assert(
  /navigateToSchedulerFocusedAppointment\(navigate, appt, practiceTz\)/.test(searchSrc),
  'Appointment Search View appointment must share the same helper',
);

console.log('patientAppointmentsOpenOnScheduleSmoke: ok');

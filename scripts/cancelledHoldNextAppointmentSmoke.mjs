/**
 * Smoke: canceled HOLDs must not surface as Next Appointment (patient details /
 * care outreach View details) or under Appointment Search → Future.
 *
 * Repro (bugs-scout thread 1791561138.234249): Tigré / Brittany Bagley —
 * patient details showed HOLD 1/11/2027; schedule had no hold; Appointment
 * Search listed the same visit as HOLD + "Canceled Appointment" because cancel
 * lived on confirmStatusName only.
 *
 * Run: node scripts/cancelledHoldNextAppointmentSmoke.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/** Mirrors isAppointmentCancelledOnPracticeCalendar for confirm-only cancel. */
function isCancelledOnPracticeCalendar(a) {
  if (a.cancellationFlag === true || a.isCancelled === true || a.cancelled === true) {
    return true;
  }
  const norm = (v) =>
    typeof v === 'string' ? v.trim().toLowerCase().replace(/\s+/g, ' ') : '';
  const labels = new Set([
    'canceled appointment',
    'cancelled appointment',
    'canceled',
    'cancelled',
  ]);
  return labels.has(norm(a.confirmStatusName)) || labels.has(norm(a.statusName));
}

function isFutureCountable(a, asOfMs) {
  if (a.isDeleted === true) return false;
  if (isCancelledOnPracticeCalendar(a)) return false;
  const startMs = Date.parse(a.appointmentStart);
  return Number.isFinite(startMs) && startMs > asOfMs;
}

function isCancelledOrDeletedForSearch(a) {
  if (a.isDeleted) return true;
  return isCancelledOnPracticeCalendar(a);
}

const asOfMs = Date.parse('2026-10-09T16:00:00.000Z');
const cancelledHold = {
  id: 1,
  isDeleted: false,
  appointmentStart: '2027-01-11T14:40:00.000Z',
  appointmentType: { name: 'HOLD' },
  statusName: null,
  confirmStatusName: 'Canceled Appointment',
};
const activeHold = {
  id: 2,
  isDeleted: false,
  appointmentStart: '2027-02-01T15:00:00.000Z',
  appointmentType: { name: 'HOLD' },
  statusName: null,
  confirmStatusName: null,
};

assert(
  !isFutureCountable(cancelledHold, asOfMs),
  'confirmStatus-only canceled HOLD must not count as next appointment',
);
assert(
  isFutureCountable(activeHold, asOfMs),
  'active HOLD must still count as next appointment',
);
assert(
  isCancelledOrDeletedForSearch(cancelledHold),
  'Appointment Search must hide confirmStatus-only canceled visits',
);
assert(
  !isCancelledOrDeletedForSearch(activeHold),
  'Appointment Search must keep active HOLDs',
);

// Legacy statusName-only check (pre-fix) would miss confirmStatus cancel:
const legacyStatusOnlyCancel = (a) => {
  if (a.isDeleted) return true;
  const status = String(a.statusName ?? '')
    .trim()
    .toLowerCase();
  return status.includes('cancel');
};
assert(
  !legacyStatusOnlyCancel(cancelledHold),
  'sanity: legacy statusName-only filter misses this cancel shape',
);

const hoverSrc = fs.readFileSync(
  path.join(root, 'src/utils/routingPatientHoverData.ts'),
  'utf8',
);
const nextSrc = fs.readFileSync(
  path.join(root, 'src/utils/nextScheduledAppointmentForVisit.ts'),
  'utf8',
);
const searchSrc = fs.readFileSync(
  path.join(root, 'src/components/pims/AppointmentSearchHistory.tsx'),
  'utf8',
);

assert(
  /isAppointmentCancelledOnPracticeCalendar/.test(hoverSrc),
  'routingPatientHoverData must use isAppointmentCancelledOnPracticeCalendar',
);
assert(
  /isAppointmentCancelledOnPracticeCalendar\(a\)/.test(hoverSrc) &&
    /function isFutureAppointment/.test(hoverSrc),
  'Next Appointment future filter must exclude canceled visits',
);
assert(
  /isAppointmentCancelledOnPracticeCalendar/.test(nextSrc),
  'nextScheduledAppointmentForVisit must use isAppointmentCancelledOnPracticeCalendar',
);
assert(
  /isAppointmentCancelledOnPracticeCalendar\(appt\)/.test(searchSrc),
  'AppointmentSearchHistory must use shared cancel helper (not statusName-only)',
);
assert(
  !/status\.includes\('cancel'\)/.test(searchSrc),
  'AppointmentSearchHistory must not rely on statusName.includes(cancel) alone',
);

console.log('cancelledHoldNextAppointmentSmoke: ok');

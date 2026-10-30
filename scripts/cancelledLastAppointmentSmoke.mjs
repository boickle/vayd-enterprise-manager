/**
 * Smoke: canceled visits must not surface as Last Appointment (or Next) in
 * patient details / routing hover summary.
 *
 * Repro (bugs-scout thread 1793381915.866439): Popcorn patient details showed
 * Last Appointment as the 10/6/2026 HOLD with status "Canceled Appointment";
 * real last visit was 9/2.
 *
 * Run: node scripts/cancelledLastAppointmentSmoke.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/** Mirrors isAppointmentCancelledOnPracticeCalendar for confirm/status cancel. */
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

function isPastCountable(a, asOfMs) {
  if (a.isDeleted === true) return false;
  if (isCancelledOnPracticeCalendar(a)) return false;
  const startMs = Date.parse(a.appointmentStart);
  return Number.isFinite(startMs) && startMs <= asOfMs;
}

function isFutureCountable(a, asOfMs) {
  if (a.isDeleted === true) return false;
  if (isCancelledOnPracticeCalendar(a)) return false;
  const startMs = Date.parse(a.appointmentStart);
  return Number.isFinite(startMs) && startMs > asOfMs;
}

function pickLast(appointments, asOfMs) {
  return appointments
    .filter((a) => isPastCountable(a, asOfMs))
    .sort((a, b) => Date.parse(b.appointmentStart) - Date.parse(a.appointmentStart))[0];
}

function pickNext(appointments, asOfMs) {
  return appointments
    .filter((a) => isFutureCountable(a, asOfMs))
    .sort((a, b) => Date.parse(a.appointmentStart) - Date.parse(b.appointmentStart))[0];
}

// Popcorn-shaped timeline (America/New_York midday ≈ UTC afternoon).
const asOfMs = Date.parse('2026-10-30T16:00:00.000Z');
const cancelledHoldOct6 = {
  id: 1,
  isDeleted: false,
  appointmentStart: '2026-10-06T16:45:00.000Z',
  appointmentType: { name: 'HOLD' },
  statusName: 'Canceled Appointment',
  confirmStatusName: 'Canceled Appointment',
};
const recheckSep2 = {
  id: 2,
  isDeleted: false,
  appointmentStart: '2026-09-02T19:00:00.000Z',
  appointmentType: { prettyName: 'Recheck / follow-up' },
  statusName: 'Client Submitted Pre-Appt form',
  confirmStatusName: null,
};
const techNov5 = {
  id: 3,
  isDeleted: false,
  appointmentStart: '2026-11-05T19:10:00.000Z',
  appointmentType: { prettyName: 'Technician visit' },
  statusName: 'Pre-Appt Email Sent',
  confirmStatusName: null,
};
const confirmOnlyCancelledPast = {
  id: 4,
  isDeleted: false,
  appointmentStart: '2026-10-01T15:00:00.000Z',
  appointmentType: { name: 'HOLD' },
  statusName: null,
  confirmStatusName: 'Canceled Appointment',
};

const appointments = [techNov5, cancelledHoldOct6, recheckSep2, confirmOnlyCancelledPast];

const last = pickLast(appointments, asOfMs);
assert(last?.id === 2, `Last Appointment must be Sep 2 recheck, got id=${last?.id}`);
assert(
  !isPastCountable(cancelledHoldOct6, asOfMs),
  'status canceled HOLD must not count as last appointment',
);
assert(
  !isPastCountable(confirmOnlyCancelledPast, asOfMs),
  'confirmStatus-only canceled past HOLD must not count as last appointment',
);

const next = pickNext(appointments, asOfMs);
assert(next?.id === 3, `Next Appointment must be Nov 5 tech visit, got id=${next?.id}`);

const hoverSrc = fs.readFileSync(
  path.join(root, 'src/utils/routingPatientHoverData.ts'),
  'utf8',
);
const nextSrc = fs.readFileSync(
  path.join(root, 'src/utils/nextScheduledAppointmentForVisit.ts'),
  'utf8',
);

assert(
  /isAppointmentCancelledOnPracticeCalendar/.test(hoverSrc),
  'routingPatientHoverData must use isAppointmentCancelledOnPracticeCalendar',
);
assert(
  /function isBookablePastAppointment[\s\S]*isAppointmentCancelledOnPracticeCalendar\(a\)/.test(
    hoverSrc,
  ),
  'Last Appointment past filter must exclude canceled visits',
);
assert(
  /function isFutureAppointment[\s\S]*isAppointmentCancelledOnPracticeCalendar\(a\)/.test(
    hoverSrc,
  ),
  'Next Appointment future filter must exclude canceled visits',
);
assert(
  /isAppointmentCancelledOnPracticeCalendar/.test(nextSrc),
  'nextScheduledAppointmentForVisit must use isAppointmentCancelledOnPracticeCalendar',
);

console.log('cancelledLastAppointmentSmoke: ok');

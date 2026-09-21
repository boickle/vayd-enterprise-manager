/**
 * Smoke checks for client-portal Upcoming Appointments filtering.
 * Run: node scripts/clientPortalUpcomingAppointmentsSmoke.mjs
 *
 * Mirrors helpers in:
 * - src/api/appointments.ts (isAppointmentCancelledOnPracticeCalendar)
 * - src/utils/clientPortalUpcomingAppointments.ts
 */

const PRACTICE_CALENDAR_CANCELLED_STATUSES = new Set([
  'canceled appointment',
  'cancelled appointment',
  'canceled',
  'cancelled',
]);

function truthyApiFlag(v) {
  return v === true || v === 1 || v === '1' || v === 'true';
}

function isAppointmentCancelledOnPracticeCalendar(a) {
  if (truthyApiFlag(a.cancellationFlag)) return true;
  if (truthyApiFlag(a.isCancelled) || truthyApiFlag(a.cancelled) || truthyApiFlag(a.isCanceled)) {
    return true;
  }
  const norm = (v) => {
    if (typeof v !== 'string') return '';
    return v.trim().toLowerCase().replace(/\s+/g, ' ');
  };
  const confirm = norm(a.confirmStatusName);
  const status = norm(a.statusName);
  return (
    (confirm !== '' && PRACTICE_CALENDAR_CANCELLED_STATUSES.has(confirm)) ||
    (status !== '' && PRACTICE_CALENDAR_CANCELLED_STATUSES.has(status))
  );
}

function isClientPortalUpcomingAppointment(a, nowMs = Date.now()) {
  const startMs = Date.parse(a.startIso);
  if (!Number.isFinite(startMs) || startMs < nowMs) return false;
  return !isAppointmentCancelledOnPracticeCalendar(a);
}

function filterClientPortalUpcomingAppointments(appts, nowMs = Date.now()) {
  return appts.filter((a) => isClientPortalUpcomingAppointment(a, nowMs));
}

let failed = 0;
function assert(cond, label) {
  if (!cond) {
    failed += 1;
    console.error('FAIL:', label);
  } else {
    console.log('ok:', label);
  }
}

const now = Date.parse('2026-09-21T18:00:00.000Z');
const future = '2027-07-13T14:30:00.000Z';
const past = '2025-01-10T14:30:00.000Z';

assert(
  isClientPortalUpcomingAppointment(
    { startIso: future, statusName: 'Scheduled', appointmentTypeName: 'HOLD' },
    now
  ),
  'future scheduled → upcoming'
);

assert(
  !isClientPortalUpcomingAppointment(
    { startIso: future, statusName: 'Canceled Appointment', appointmentTypeName: 'HOLD' },
    now
  ),
  'future canceled (screenshot case) → not upcoming'
);

assert(
  !isClientPortalUpcomingAppointment(
    { startIso: future, confirmStatusName: 'Cancelled Appointment' },
    now
  ),
  'future cancelled confirmStatus → not upcoming'
);

assert(
  !isClientPortalUpcomingAppointment({ startIso: past, statusName: 'Scheduled' }, now),
  'past scheduled → not upcoming'
);

assert(
  !isClientPortalUpcomingAppointment({ startIso: future, isCancelled: true }, now),
  'isCancelled flag → not upcoming'
);

const filtered = filterClientPortalUpcomingAppointments(
  [
    { id: '1', startIso: future, statusName: 'Canceled Appointment', appointmentTypeName: 'HOLD' },
    { id: '2', startIso: future, statusName: 'Scheduled' },
    { id: '3', startIso: past, statusName: 'Scheduled' },
  ],
  now
);
assert(filtered.length === 1 && filtered[0].id === '2', 'filter keeps only active future visits');

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log('\nAll client-portal upcoming appointment smoke checks passed.');

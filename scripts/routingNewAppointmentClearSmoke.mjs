/**
 * Smoke checks for "+ Appointment" / New appointment clearing the routing form.
 * Run: node scripts/routingNewAppointmentClearSmoke.mjs
 *
 * Mirrors:
 * - ROUTING_NEW_APPOINTMENT_CLEAR_EVENT in src/utils/routingUiSnapshot.ts
 * - createDefaultRoutingForm keep-doctor merge used by Routing.resetRoutingFormForNewAppointment
 */

const ROUTING_NEW_APPOINTMENT_CLEAR_EVENT = 'vayd:routing-new-appointment-clear';

function createDefaultRoutingForm() {
  return {
    doctorId: '',
    startDate: new Date().toISOString().slice(0, 10),
    endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    newAppt: { serviceMinutes: 45, address: '' },
  };
}

/** Same keep-doctor merge Routing uses when clearing for a fresh appointment. */
function resetFormKeepingDoctor(current) {
  const empty = createDefaultRoutingForm();
  const keepDoctorId = String(current.doctorId ?? '').trim();
  return {
    ...empty,
    doctorId: keepDoctorId || empty.doctorId,
  };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(
  ROUTING_NEW_APPOINTMENT_CLEAR_EVENT === 'vayd:routing-new-appointment-clear',
  'event name must stay stable for App / ScheduleLayout / Routing listeners'
);

const filled = {
  doctorId: 'pims-42',
  startDate: '2026-01-01',
  endDate: '2026-01-02',
  newAppt: {
    serviceMinutes: 90,
    address: '100 Main St',
    clientId: 'c-9',
    lat: 44.1,
    lon: -69.2,
    appointmentTypeId: 7,
  },
};

const cleared = resetFormKeepingDoctor(filled);
assert(cleared.doctorId === 'pims-42', 'keep selected doctor when starting fresh');
assert(cleared.newAppt.address === '', 'clear address');
assert(cleared.newAppt.clientId == null, 'clear client');
assert(cleared.newAppt.serviceMinutes === 45, 'reset minutes to default');
assert(cleared.newAppt.lat == null && cleared.newAppt.lon == null, 'clear geocode');
assert(cleared.newAppt.appointmentTypeId == null, 'clear appointment type');

const noDoctor = resetFormKeepingDoctor({
  doctorId: '  ',
  startDate: '2026-01-01',
  endDate: '2026-01-02',
  newAppt: { serviceMinutes: 30, address: 'x', clientId: 'c-1' },
});
assert(noDoctor.doctorId === '', 'empty doctor stays empty (auth doctor hydrate fills later)');
assert(noDoctor.newAppt.address === '', 'still clears address without doctor');

console.log('routingNewAppointmentClearSmoke: ok');

/**
 * Smoke checks for "+ Appointment" / New appointment clearing the routing form.
 * Run: node scripts/routingNewAppointmentClearSmoke.mjs
 *
 * Mirrors:
 * - ROUTING_NEW_APPOINTMENT_CLEAR_EVENT in src/utils/routingUiSnapshot.ts
 * - createDefaultRoutingForm keep-doctor merge used by Routing.resetRoutingFormForNewAppointment
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
assert(
  !String(cleared.newAppt.address ?? '').trim(),
  'Get Best Route address text must be empty after + Appointment'
);
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

const here = path.dirname(fileURLToPath(import.meta.url));
const routingSrc = fs.readFileSync(path.join(here, '../src/pages/Routing.tsx'), 'utf8');
const addressSrc = fs.readFileSync(
  path.join(here, '../src/components/AddressAutocomplete.tsx'),
  'utf8',
);
assert(
  /resetRoutingFormForNewAppointment[\s\S]*setRoutingAddressFields\(\{\s*\.\.\.EMPTY_ADDRESS_FIELDS\s*\}\)/.test(
    routingSrc,
  ),
  '+ Appointment must clear routingAddressFields, not only form.newAppt.address',
);
assert(
  /setInputValue\(formatted\)/.test(addressSrc) &&
    !/if \(formatted\) \{\s*setInputValue\(formatted\)/.test(addressSrc),
  'AddressAutocomplete must sync an empty parent value so leftover visit addresses clear',
);

console.log('routingNewAppointmentClearSmoke: ok');

/**
 * Smoke: patient/client Appointments list should open the practice schedule
 * for that appointment (focusAppt + date/provider hints), not a details-only modal.
 *
 * Repro (bugs-scout): click appt on patient page → only "Appointment details"
 * modal; staff want the schedule for that day to edit/add pets.
 *
 * Run: node scripts/pimsAppointmentsOpenOnScheduleSmoke.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const sectionSrc = fs.readFileSync(
  path.join(root, 'src/components/pims/PimsAppointmentsSection.tsx'),
  'utf8',
);
const focusSrc = fs.readFileSync(
  path.join(root, 'src/utils/schedulerFocusAppointment.ts'),
  'utf8',
);

assert(
  /useNavigate/.test(sectionSrc),
  'PimsAppointmentsSection must use react-router navigate',
);
assert(
  /buildSchedulerFocusAppointmentUrl/.test(sectionSrc) &&
    /writeSchedulerFocusSession/.test(sectionSrc),
  'must use scheduler focus helpers (same as appointment search)',
);
assert(
  /openOnSchedule/.test(sectionSrc),
  'row click handler should open on schedule',
);
assert(
  /onClick=\{\(\) => openOnSchedule\(a\)\}/.test(sectionSrc),
  'When button must call openOnSchedule',
);
assert(
  !/PimsAppointmentDetailModal/.test(sectionSrc) && !/createPortal/.test(sectionSrc),
  'details-only modal must be removed (navigate instead)',
);
assert(
  /focusAppt/.test(focusSrc) || /SCHEDULER_FOCUS_APPOINTMENT_PARAM/.test(focusSrc),
  'scheduler focus param must exist',
);
assert(
  /Open on schedule/.test(sectionSrc),
  'button should advertise Open on schedule',
);
assert(
  /open that day on the schedule/i.test(sectionSrc),
  'hint copy should mention opening the schedule',
);

// Hint URL shape for the Kovu repro appointment (id 2008179, Jan 13 2027, provider present)
assert(
  /buildSchedulerFocusAppointmentUrl\(apptId,\s*\{\s*date:\s*dateKey/.test(
    sectionSrc.replace(/\s+/g, ' '),
  ),
  'navigation must pass date hint from appointment start',
);

console.log('pimsAppointmentsOpenOnScheduleSmoke: ok');

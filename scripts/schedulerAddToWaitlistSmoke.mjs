/**
 * Smoke: schedule right-click → Add to waitlist opens the existing add modal
 * prefilled from the visit (client, pets, type, preferred doctor).
 *
 * Repro (bugs-scout thread 1787923537.983119): staff wanted Add to waitlist
 * from the calendar context menu; product confirmed scoped go-ahead.
 *
 * Run: node scripts/schedulerAddToWaitlistSmoke.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const utilSrc = fs.readFileSync(
  path.join(root, 'src/utils/waitlistAddPrefillFromAppointment.ts'),
  'utf8',
);
const modalSrc = fs.readFileSync(path.join(root, 'src/components/WaitlistAddModal.tsx'), 'utf8');
const menuSrc = fs.readFileSync(path.join(root, 'src/pages/SchedulerContextMenu.tsx'), 'utf8');
const schedulerSrc = fs.readFileSync(path.join(root, 'src/pages/Scheduler.tsx'), 'utf8');

assert(
  /export function buildWaitlistAddPrefillFromAppointment/.test(utilSrc),
  'util must export buildWaitlistAddPrefillFromAppointment',
);
assert(/export function waitlistAddDisabledReason/.test(utilSrc), 'util must export waitlistAddDisabledReason');
assert(/patientIds/.test(utilSrc) && /appointmentTypeId/.test(utilSrc), 'prefill must carry pets + type');
assert(/preferredProviderId/.test(utilSrc), 'prefill must carry preferred doctor');
assert(
  /Needs a linked client to add to the waitlist/.test(utilSrc),
  'blocks without client must be rejected',
);

assert(/prefill\?:/.test(modalSrc) || /prefill = null/.test(modalSrc), 'WaitlistAddModal must accept prefill');
assert(
  /prefill\.clientId/.test(modalSrc) && /prefill\.patientIds/.test(modalSrc),
  'modal must apply client + pets from prefill',
);
assert(
  /selectedClient \|\| q\.length < 2/.test(modalSrc),
  'search must not reopen when a prefilled client is already selected',
);

assert(/kind: 'addToWaitlist'/.test(menuSrc), 'context menu action union must include addToWaitlist');
assert(/label="Add to waitlist"/.test(menuSrc), 'Scheduling submenu must show Add to waitlist');
assert(
  /onAction\(\{ kind: 'addToWaitlist' \}\)/.test(menuSrc),
  'Add to waitlist row must emit the action',
);

assert(/case 'addToWaitlist'/.test(schedulerSrc), 'Scheduler must handle addToWaitlist');
assert(
  /setWaitlistAddPrefill\(prefill\)/.test(schedulerSrc),
  'Scheduler must open modal with appointment prefill',
);
assert(
  /<WaitlistAddModal[\s\S]*prefill=\{waitlistAddPrefill\}/.test(schedulerSrc),
  'Scheduler must render WaitlistAddModal with prefill',
);
assert(
  /addToWaitlistDisabled=\{Boolean\(contextMenuAddToWaitlistDisabledTitle\)\}/.test(schedulerSrc),
  'menu must disable Add to waitlist when visit cannot be waitlisted',
);

// --- Pure eligibility / prefill shape mirror (no React) ---
function disabledReason(appt) {
  if (appt?.type === 'block' || appt?.isBlock === true || appt?.isPersonalBlock === true) {
    return 'Calendar blocks cannot be added to the waitlist.';
  }
  const typeName = String(appt?.appointmentType?.prettyName || appt?.appointmentType?.name || '')
    .trim()
    .toLowerCase();
  if (typeName.includes('note to staff') || typeName === 'vacation' || typeName === 'sick time') {
    return 'Staff calendar items cannot be added to the waitlist.';
  }
  const clientId = Number(appt?.client?.id);
  if (!Number.isFinite(clientId) || clientId <= 0) {
    return 'Needs a linked client to add to the waitlist.';
  }
  return undefined;
}

function buildPrefill(appt) {
  if (disabledReason(appt)) return null;
  const client = appt.client;
  const clientId = Number(client.id);
  const patientIds = [];
  if (Array.isArray(appt.patients)) {
    for (const p of appt.patients) {
      const id = Number(p?.id);
      if (Number.isFinite(id) && id > 0) patientIds.push(id);
    }
  } else if (appt.patient?.id != null) {
    const id = Number(appt.patient.id);
    if (Number.isFinite(id) && id > 0) patientIds.push(id);
  }
  const typeId = Number(appt.appointmentType?.id);
  const providerId = Number(appt.primaryProvider?.id);
  return {
    clientId,
    clientLabel: `${client.firstName} ${client.lastName}`.trim(),
    patientIds,
    ...(Number.isFinite(typeId) && typeId > 0 ? { appointmentTypeId: typeId } : {}),
    ...(Number.isFinite(providerId) && providerId > 0 ? { preferredProviderId: providerId } : {}),
  };
}

const visit = {
  id: 1,
  client: { id: 10087, firstName: 'Charlene', lastName: 'Davis' },
  patients: [{ id: 222938, name: 'Kovu' }],
  appointmentType: { id: 12, name: 'Wellness visit / check-up' },
  primaryProvider: { id: 7, firstName: 'Kate', lastName: 'Cheeseman' },
};
const prefill = buildPrefill(visit);
assert(prefill?.clientId === 10087, 'client id');
assert(prefill?.patientIds?.[0] === 222938, 'visit pet selected');
assert(prefill?.appointmentTypeId === 12, 'type prefilled');
assert(prefill?.preferredProviderId === 7, 'doctor prefilled');
assert(disabledReason({ id: 2, type: 'block' }), 'blocks disabled');
assert(disabledReason({ id: 3, appointmentType: { name: 'Note To Staff' } }), 'notes disabled');
assert(disabledReason({ id: 4 }), 'no-client disabled');

console.log('schedulerAddToWaitlistSmoke: ok');

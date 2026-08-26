/**
 * Smoke checks: client-linked no-patient visits (ash drop-off) can reschedule / explore alternatives.
 * Run: node scripts/routingNoPatientRescheduleSmoke.mjs
 *
 * Mirrors the gate in src/utils/routingRescheduleIntent.ts + defaultRescheduleSelectedPatientIds.
 */

function isBlock(appt) {
  return (
    appt?.type === 'block' ||
    appt?.isBlock === true ||
    appt?.isPersonalBlock === true
  );
}

function hasVisitAddress(appt) {
  const alt =
    appt?.alternateAddressText?.trim() ||
    appt?.alternateAddress?.addressText?.trim() ||
    '';
  if (alt) return true;
  const parts = [appt?.address1, appt?.city, appt?.state, appt?.zip || appt?.zipcode]
    .map((x) => (x == null ? '' : String(x).trim()))
    .filter(Boolean);
  return parts.length > 0;
}

/**
 * Eligibility mirror of buildRoutingRescheduleIntentFromAppointment:
 * - blocks never
 * - linked client → yes (patient optional)
 * - else address-only when allowed
 */
function canBuildRescheduleIntent(appt, opts = {}) {
  if (!appt || typeof appt.id !== 'number') return false;
  if (isBlock(appt)) return false;
  const clientId = appt.client?.id ?? appt.clientId;
  if (clientId != null && String(clientId).trim() !== '') return true;
  if (!opts.allowAddressOnly) return false;
  return hasVisitAddress(appt);
}

function readIntentAccepts(o) {
  if (o?.v !== 1 || typeof o.appointmentId !== 'number') return false;
  const hasClient = Boolean(o.clientId?.trim());
  const hasAddressOnly =
    Boolean(o.isAlternateStop) &&
    Boolean(o.address?.trim() || o.alternateAddressText?.trim());
  return hasClient || hasAddressOnly;
}

function defaultRescheduleSelectedPatientIds(intent) {
  const sameDay = intent.sameDayVisits ?? [];
  const primary = intent.patientId?.trim() ?? '';
  if (sameDay.length > 1) {
    if (intent.rescheduleScope === 'selected_pet') {
      return primary ? [primary] : [];
    }
    return sameDay.map((v) => String(v.patientId)).filter((id) => id.trim());
  }
  return primary ? [primary] : [];
}

/** Mirror of the Routing preview payload chip filter (src/pages/Routing.tsx). */
function previewPatientsForPayload(visits) {
  return visits
    .filter((v) => String(v.patientId ?? '').trim())
    .map((v) => ({ id: v.patientId, name: v.patientName?.trim() || `Pet ${v.patientId}` }));
}

/** Mirror of the calendar ghost fallback rows (src/pages/Scheduler.tsx). */
function previewPatientRowsFromIntent(intent) {
  const anchorPatientId = intent.patientId?.trim() ?? '';
  const sameDay = intent.sameDayVisits ?? [];
  const visits =
    intent.rescheduleScope === 'household_day'
      ? sameDay
      : anchorPatientId && sameDay.length
        ? [sameDay.find((v) => v.patientId === anchorPatientId) ?? sameDay[0]]
        : [];
  return visits.map((v) => ({ id: v.patientId, name: v.patientName?.trim() || `Pet ${v.patientId}` }));
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const ashDropOff = {
  id: 4242,
  client: { id: 99, firstName: 'Hannah', lastName: 'Reese' },
  appointmentType: { id: 12, name: 'Ash Drop Off', prettyName: 'Ash Drop Off' },
  appointmentStart: '2026-08-12T12:50:00.000Z',
  appointmentEnd: '2026-08-12T14:50:00.000Z',
};

assert(
  canBuildRescheduleIntent(ashDropOff, { allowAddressOnly: true }),
  'ash drop-off with linked client should build reschedule intent'
);
assert(
  canBuildRescheduleIntent(ashDropOff, { allowAddressOnly: false }),
  'ash drop-off with linked client should not require allowAddressOnly'
);

assert(
  !canBuildRescheduleIntent(
    { id: 1, type: 'block', client: { id: 1 } },
    { allowAddressOnly: true }
  ),
  'blocks stay blocked even with a client'
);

assert(
  !canBuildRescheduleIntent(
    { id: 2, appointmentType: { name: 'Hold' } },
    { allowAddressOnly: true }
  ),
  'no client and no address → cannot build'
);

assert(
  canBuildRescheduleIntent(
    {
      id: 3,
      isAlternateStop: true,
      alternateAddressText: '12 Main St, Brunswick, ME',
    },
    { allowAddressOnly: true }
  ),
  'address-only hold still works'
);

assert(
  readIntentAccepts({
    v: 1,
    appointmentId: 4242,
    clientId: '99',
    patientId: '',
  }),
  'stored client-only intent (empty patientId) must be readable'
);

assert(
  !readIntentAccepts({
    v: 1,
    appointmentId: 4242,
    clientId: '',
    patientId: '',
  }),
  'empty client + empty patient without address is rejected'
);

assert(
  JSON.stringify(defaultRescheduleSelectedPatientIds({ patientId: '' })) === '[]',
  'no-patient reschedule must not select a blank pet chip'
);

assert(
  JSON.stringify(defaultRescheduleSelectedPatientIds({ patientId: '55' })) === '["55"]',
  'normal reschedule still selects the visit patient'
);

assert(
  previewPatientsForPayload([{ appointmentId: 4242, patientId: '' }]).length === 0,
  'no-patient anchor must not become a preview pet chip'
);

assert(
  JSON.stringify(previewPatientsForPayload([{ appointmentId: 7, patientId: '55', patientName: 'Rex' }])) ===
    '[{"id":"55","name":"Rex"}]',
  'normal reschedule still previews its pet'
);

assert(
  previewPatientRowsFromIntent({
    patientId: '',
    sameDayVisits: [{ appointmentId: 88, patientId: '55', patientName: 'Rex' }],
  }).length === 0,
  'no-patient anchor must not borrow a household pet for the calendar ghost'
);

assert(
  JSON.stringify(
    previewPatientRowsFromIntent({
      patientId: '',
      rescheduleScope: 'household_day',
      sameDayVisits: [{ appointmentId: 88, patientId: '55', patientName: 'Rex' }],
    })
  ) === '[{"id":"55","name":"Rex"}]',
  'household_day scope still previews every selected pet'
);

console.log('routingNoPatientRescheduleSmoke: ok');

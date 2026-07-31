/**
 * Smoke checks for euthanasia patient-inactivation helpers.
 * Run: node scripts/euthanasiaPatientInactivateSmoke.mjs
 *
 * Mirrors pure helpers in src/utils/euthanasiaFutureAppointments.ts.
 */

function isPatientRecordInactive(record) {
  if (!record) return false;
  if (record.isActive === false || record.active === false) return true;
  const st = String(record.status ?? record.patientStatus ?? '')
    .trim()
    .toLowerCase();
  return st.includes('inactive');
}

function isPatientPatchUnavailableError(err) {
  const status = err?.response?.status;
  if (status === 404 || status === 405) return true;
  const raw = err?.response?.data?.message ?? err?.response?.data?.error ?? err?.message ?? '';
  const msg = Array.isArray(raw) ? raw.join(' ') : String(raw);
  return /^Cannot\s+(PATCH|PUT)\s+\/patients\//i.test(msg.trim());
}

function looksAlreadyInactiveMessage(message) {
  return /already\s+inactive|patient\s+is\s+inactive|not\s+active/i.test(message);
}

function resolvePatientWriteId(record, fallbackId) {
  if (record?.id != null) {
    const resolved = String(record.id).trim();
    if (resolved) return resolved;
  }
  return fallbackId;
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

assert(isPatientRecordInactive({ isActive: false }), 'isActive false → inactive');
assert(isPatientRecordInactive({ active: false }), 'active false → inactive');
assert(isPatientRecordInactive({ status: 'Inactive' }), 'status Inactive → inactive');
assert(isPatientRecordInactive({ patientStatus: 'inactive pet' }), 'patientStatus inactive → inactive');
assert(!isPatientRecordInactive({ isActive: true }), 'isActive true → active');
assert(!isPatientRecordInactive(null), 'null → not inactive');

assert(
  isPatientPatchUnavailableError({
    response: { status: 404, data: { message: 'Cannot PATCH /patients/1203138' } },
  }),
  '404 Cannot PATCH → unavailable',
);
assert(
  isPatientPatchUnavailableError({
    message: 'Cannot PATCH /patients/1203138',
  }),
  'axios message Cannot PATCH → unavailable',
);
assert(
  isPatientPatchUnavailableError({ response: { status: 405 } }),
  '405 → unavailable',
);
assert(
  !isPatientPatchUnavailableError({
    response: { status: 500, data: { message: 'Internal server error' } },
  }),
  '500 → not unavailable',
);

assert(looksAlreadyInactiveMessage('Patient is already inactive'), 'already inactive phrase');
assert(!looksAlreadyInactiveMessage('Validation failed'), 'unrelated message');

assert(resolvePatientWriteId({ id: 42 }, 'pims-9') === '42', 'prefer internal id');
assert(resolvePatientWriteId(null, 'pims-9') === 'pims-9', 'fallback when no record');

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log('\nAll euthanasia patient-inactivate smoke checks passed.');

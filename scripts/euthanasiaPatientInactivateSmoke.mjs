/**
 * Smoke checks for euthanasia patient-inactivation + future-cancel helpers.
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

function coercePositiveAppointmentId(id) {
  if (typeof id === 'number') {
    return Number.isFinite(id) && id > 0 ? id : null;
  }
  if (typeof id === 'string' && id.trim()) {
    const n = Number(id.trim());
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return null;
}

function earliestAppointmentStartIso(appointments) {
  let best = null;
  let bestMs = Infinity;
  for (const a of appointments) {
    const iso = a.appointmentStart?.trim?.() ?? (typeof a.appointmentStart === 'string' ? a.appointmentStart.trim() : '');
    if (!iso) continue;
    const ms = Date.parse(iso);
    if (!Number.isFinite(ms)) continue;
    if (ms < bestMs) {
      bestMs = ms;
      best = iso;
    }
  }
  return best;
}

/** Mirrors isCountableFutureAppointment time gate only (status flags omitted for unit smoke). */
function isFutureByStart(appointmentStart, asOfMs) {
  if (!appointmentStart?.trim()) return false;
  const startMs = Date.parse(appointmentStart);
  return Number.isFinite(startMs) && startMs > asOfMs;
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

assert(coercePositiveAppointmentId(12345) === 12345, 'numeric appointment id');
assert(coercePositiveAppointmentId('12345') === 12345, 'string appointment id coerced');
assert(coercePositiveAppointmentId(' 99 ') === 99, 'trimmed string appointment id');
assert(coercePositiveAppointmentId(0) === null, 'zero id rejected');
assert(coercePositiveAppointmentId('nope') === null, 'non-numeric id rejected');
assert(coercePositiveAppointmentId(null) === null, 'null id rejected');

const euthStart = '2026-10-11T17:30:00.000Z'; // 1:30 PM ET
const asOfMs = Date.parse(euthStart);
assert(
  !isFutureByStart(euthStart, asOfMs),
  'euthanasia visit start is not future relative to its own asOf',
);
assert(
  isFutureByStart('2026-10-12T14:00:00.000Z', asOfMs),
  'later calendar visit is future relative to euthanasia start',
);
assert(
  !isFutureByStart('2026-10-11T16:00:00.000Z', asOfMs),
  'earlier same-day visit is not future relative to euthanasia start',
);

// Ending before scheduled start (wall clock 1:00 PM) must still use visit start as asOf —
// wall-clock now would wrongly classify the euthanasia card itself as future.
const wallClockBeforeStart = Date.parse('2026-10-11T17:00:00.000Z');
assert(
  isFutureByStart(euthStart, wallClockBeforeStart),
  'wall-clock-now asOf would wrongly treat this euthanasia as future (the bug)',
);
assert(
  earliestAppointmentStartIso([{ appointmentStart: euthStart }]) === euthStart,
  'earliestAppointmentStartIso returns the visit start',
);
assert(
  earliestAppointmentStartIso([
    { appointmentStart: '2026-10-11T19:00:00.000Z' },
    { appointmentStart: euthStart },
  ]) === euthStart,
  'earliestAppointmentStartIso picks the earlier start',
);
assert(earliestAppointmentStartIso([]) === null, 'earliestAppointmentStartIso empty → null');

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log('\nAll euthanasia patient-inactivate smoke checks passed.');

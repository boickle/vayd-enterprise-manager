/**
 * Smoke checks for hold CL auto-claim helpers used after reschedule / explore / book.
 * Run: node scripts/holdsAutoClaimOwnerSmoke.mjs
 *
 * Mirrors src/utils/holdOwnership.ts + isHoldAppointmentTypeForBook gating.
 */

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function normalizeEmployeeId(raw) {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function resolveStaffEmployeeIdForHoldClaim(opts) {
  const fromAuth = normalizeEmployeeId(opts.employeeId);
  if (fromAuth != null && fromAuth > 0) return fromAuth;
  const fallback = normalizeEmployeeId(opts.fallbackEmployeeId);
  if (fallback != null && fallback > 0) return fallback;
  return null;
}

function shouldClaimHold(opts) {
  const ownerId = resolveStaffEmployeeIdForHoldClaim({
    employeeId: opts.employeeId,
    fallbackEmployeeId: opts.fallbackEmployeeId,
  });
  if (ownerId == null) return false;
  if (!opts.isHoldType) return false;
  const id = Number(opts.appointmentId);
  return Number.isFinite(id) && id > 0;
}

// Prefer auth employee id over fallback
assert(
  resolveStaffEmployeeIdForHoldClaim({ employeeId: '42', fallbackEmployeeId: 99 }) === 42,
  'auth employee id should win'
);
assert(
  resolveStaffEmployeeIdForHoldClaim({ employeeId: null, fallbackEmployeeId: 99 }) === 99,
  'fallback when auth missing'
);
assert(
  resolveStaffEmployeeIdForHoldClaim({ employeeId: 0, fallbackEmployeeId: null }) == null,
  'zero employee id is invalid'
);

// Reschedule of a HOLD → claim
assert(
  shouldClaimHold({ appointmentId: 1001, employeeId: 7, isHoldType: true }) === true,
  'reschedule HOLD should claim'
);

// Reschedule of a real visit type → do not claim
assert(
  shouldClaimHold({ appointmentId: 1001, employeeId: 7, isHoldType: false }) === false,
  'reschedule non-HOLD should not claim'
);

// Explore create HOLD → claim new id
assert(
  shouldClaimHold({ appointmentId: 2002, employeeId: 7, isHoldType: true }) === true,
  'explore-created HOLD should claim'
);

// Offer / book HOLD without resolved employee → skip (manual Assign to me still works)
assert(
  shouldClaimHold({ appointmentId: 3003, employeeId: null, isHoldType: true }) === false,
  'missing employee should skip claim'
);

// Invalid appointment id → skip
assert(
  shouldClaimHold({ appointmentId: 'x', employeeId: 7, isHoldType: true }) === false,
  'invalid appointment id should skip'
);

console.log('holdsAutoClaimOwnerSmoke: ok');

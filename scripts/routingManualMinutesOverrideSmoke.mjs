/**
 * Smoke checks for Calculate Time manual Minutes override.
 * Run: node scripts/routingManualMinutesOverrideSmoke.mjs
 *
 * Mirrors helpers in src/utils/routingServiceMinutes.ts
 * (`shouldPreserveManualRoutingMinutes`, `resolveServiceMinutesAfterDoctorConfirm`).
 */

function shouldPreserveManualRoutingMinutes(minutesManuallyOverridden) {
  return Boolean(minutesManuallyOverridden);
}

function resolveServiceMinutesAfterDoctorConfirm(opts) {
  if (shouldPreserveManualRoutingMinutes(opts.minutesManuallyOverridden)) return undefined;
  const mins = Number(opts.averagedServiceMinutes);
  if (!Number.isFinite(mins) || mins < 1) return undefined;
  return Math.round(mins);
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(
  shouldPreserveManualRoutingMinutes(false) === false,
  'no override → allow autofill / re-average'
);
assert(
  shouldPreserveManualRoutingMinutes(true) === true,
  'typed Minutes → preserve against passive sync'
);

assert(
  resolveServiceMinutesAfterDoctorConfirm({
    minutesManuallyOverridden: false,
    averagedServiceMinutes: 16,
  }) === 16,
  'ASAP confirm without override uses averaged minutes (e.g. tech ~16)'
);
assert(
  resolveServiceMinutesAfterDoctorConfirm({
    minutesManuallyOverridden: false,
    averagedServiceMinutes: 45.4,
  }) === 45,
  'averaged minutes are rounded'
);
assert(
  resolveServiceMinutesAfterDoctorConfirm({
    minutesManuallyOverridden: true,
    averagedServiceMinutes: 16,
  }) === undefined,
  'typed Minutes (e.g. 30) must win over tech average on ASAP confirm'
);
assert(
  resolveServiceMinutesAfterDoctorConfirm({
    minutesManuallyOverridden: true,
    averagedServiceMinutes: 45,
  }) === undefined,
  'typed Minutes must win over HOLD fallback 45 on ASAP confirm'
);
assert(
  resolveServiceMinutesAfterDoctorConfirm({
    minutesManuallyOverridden: false,
    averagedServiceMinutes: null,
  }) === undefined,
  'missing average → keep form minutes'
);
assert(
  resolveServiceMinutesAfterDoctorConfirm({
    minutesManuallyOverridden: false,
    averagedServiceMinutes: 0,
  }) === undefined,
  'invalid average → keep form minutes'
);

// Lifecycle: type/pet change clears override, then autofill may run again
let overridden = true;
assert(shouldPreserveManualRoutingMinutes(overridden) === true, 'override active');
overridden = false; // form handler on type/pets change
assert(
  resolveServiceMinutesAfterDoctorConfirm({
    minutesManuallyOverridden: overridden,
    averagedServiceMinutes: 45,
  }) === 45,
  'after clearing override, type-driven average applies again'
);

console.log('routingManualMinutesOverrideSmoke: ok');

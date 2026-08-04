/**
 * Smoke checks for Calculate Time minutes autofill during reschedule.
 * Run: node scripts/routingRescheduleMinutesAutofillSmoke.mjs
 *
 * Mirrors shouldPassiveAutofillRoutingMinutes in src/utils/routingServiceMinutes.ts.
 */

function shouldPassiveAutofillRoutingMinutes(opts) {
  if (!opts.hasActiveRescheduleIntent) return true;
  const mins = Number(opts.currentServiceMinutes);
  return !(Number.isFinite(mins) && mins > 0);
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// New booking / non-reschedule: always allow passive sync
assert(
  shouldPassiveAutofillRoutingMinutes({
    hasActiveRescheduleIntent: false,
    currentServiceMinutes: 90,
  }) === true,
  'non-reschedule with minutes should passive-autofill'
);
assert(
  shouldPassiveAutofillRoutingMinutes({
    hasActiveRescheduleIntent: false,
    currentServiceMinutes: 0,
  }) === true,
  'non-reschedule with 0 minutes should passive-autofill'
);

// Reschedule: preserve original duration on hydrate / stats load
assert(
  shouldPassiveAutofillRoutingMinutes({
    hasActiveRescheduleIntent: true,
    currentServiceMinutes: 90,
  }) === false,
  'reschedule with original minutes must not passive-overwrite'
);
assert(
  shouldPassiveAutofillRoutingMinutes({
    hasActiveRescheduleIntent: true,
    currentServiceMinutes: 45,
  }) === false,
  'reschedule with positive minutes must not passive-overwrite'
);

// Reschedule: fill when minutes are missing/invalid (bug: Minutes stuck at 0)
assert(
  shouldPassiveAutofillRoutingMinutes({
    hasActiveRescheduleIntent: true,
    currentServiceMinutes: 0,
  }) === true,
  'reschedule with 0 minutes should passive-autofill'
);
assert(
  shouldPassiveAutofillRoutingMinutes({
    hasActiveRescheduleIntent: true,
    currentServiceMinutes: NaN,
  }) === true,
  'reschedule with NaN minutes should passive-autofill'
);
assert(
  shouldPassiveAutofillRoutingMinutes({
    hasActiveRescheduleIntent: true,
    currentServiceMinutes: -5,
  }) === true,
  'reschedule with negative minutes should passive-autofill'
);

console.log('routingRescheduleMinutesAutofillSmoke: ok');

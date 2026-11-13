/**
 * Smoke: FE household drive clumps match API 1hr merge gap + shared earliest window.
 * Run: node scripts/householdDriveClumpMergeSmoke.mjs
 */

/** @type {typeof import('../src/utils/schedulerDriveEta.ts')} */
// Pure mirrors of schedulerDriveEta helpers (no bundler in smoke scripts).

const HOUSEHOLD_DRIVE_MERGE_GAP_MS = 60 * 60 * 1000;

function scheduledIntervalsClumped(aStart, aEnd, bStart, bEnd, mergeGapMs = HOUSEHOLD_DRIVE_MERGE_GAP_MS) {
  if (aStart <= bEnd && bStart <= aEnd) return true;
  const earlierEnd = aStart <= bStart ? aEnd : bEnd;
  const laterStart = aStart <= bStart ? bStart : aStart;
  return laterStart <= earlierEnd + mergeGapMs;
}

function resolveArrivalWindowIsos(args) {
  const h = args.household;
  const doctorDayStart =
    h?.effectiveWindow?.startIso?.trim() ||
    h?.windowStartIso?.trim() ||
    h?.primary?.effectiveWindow?.startIso?.trim() ||
    null;
  const doctorDayEnd =
    h?.effectiveWindow?.endIso?.trim() ||
    h?.windowEndIso?.trim() ||
    h?.primary?.effectiveWindow?.endIso?.trim() ||
    null;
  const householdWindow =
    doctorDayStart && doctorDayEnd ? { startIso: doctorDayStart, endIso: doctorDayEnd } : null;

  if (args.preferHouseholdWindow && householdWindow) return householdWindow;

  const apptStart = args.apptEffectiveWindow?.startIso?.trim() || null;
  const apptEnd = args.apptEffectiveWindow?.endIso?.trim() || null;
  if (apptStart && apptEnd) return { startIso: apptStart, endIso: apptEnd };
  if (householdWindow) return householdWindow;
  return null;
}

function expandPreFirstNeighborBumpToHousehold(opts) {
  const mergeGapMs = opts.mergeGapMs ?? HOUSEHOLD_DRIVE_MERGE_GAP_MS;
  const anchor = opts.appointments.find((a) => Number(a.id) === Number(opts.bump.appointmentId));
  if (!anchor?.client?.id) {
    return [opts.bump];
  }
  const clientId = String(anchor.client.id);
  const anchorStart = Date.parse(anchor.appointmentStart);
  const anchorEnd = Date.parse(anchor.appointmentEnd);
  const newStartMs = Date.parse(opts.bump.appointmentStart);
  const byId = new Map();
  byId.set(Number(opts.bump.appointmentId), { ...opts.bump });

  for (const a of opts.appointments) {
    if (a.client?.id == null || String(a.client.id) !== clientId) continue;
    const id = Number(a.id);
    if (!Number.isFinite(id) || id <= 0 || byId.has(id)) continue;
    const s = Date.parse(a.appointmentStart);
    const e = Date.parse(a.appointmentEnd);
    if (!Number.isFinite(s) || !Number.isFinite(e)) continue;
    const earlierEnd = anchorStart <= s ? anchorEnd : e;
    const laterStart = anchorStart <= s ? s : anchorStart;
    const overlaps = anchorStart <= e && s <= anchorEnd;
    const withinGap = laterStart <= earlierEnd + mergeGapMs;
    if (!overlaps && !withinGap) continue;
    const durationMs = Math.max(60_000, e - s);
    byId.set(id, {
      appointmentId: id,
      appointmentStart: opts.bump.appointmentStart,
      appointmentEnd: new Date(newStartMs + durationMs).toISOString(),
    });
  }
  return [...byId.values()];
}

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed += 1;
  } else {
    console.log('ok:', msg);
  }
}

// Potvin-style: ~40m stagger with a gap between service intervals → still one clump (API 1hr).
const oleStart = Date.parse('2027-02-08T13:45:00.000Z');
const oleEnd = Date.parse('2027-02-08T14:15:00.000Z');
const soleilStart = Date.parse('2027-02-08T14:25:00.000Z');
const soleilEnd = Date.parse('2027-02-08T14:55:00.000Z');
assert(
  !scheduledIntervalsClumped(oleStart, oleEnd, soleilStart, soleilEnd, 0),
  'overlap-only would NOT clump Potvins with a service gap'
);
assert(
  scheduledIntervalsClumped(oleStart, oleEnd, soleilStart, soleilEnd),
  '1hr merge gap clumps Potvins (~10m gap after Ole end)'
);

// Morning + afternoon stay separate (>1hr after earlier end).
const amEnd = Date.parse('2027-02-08T15:00:00.000Z');
const pmStart = Date.parse('2027-02-08T17:30:00.000Z');
assert(
  !scheduledIntervalsClumped(oleStart, amEnd, pmStart, pmStart + 30 * 60000),
  'morning/afternoon >1hr gap stays split'
);

const household = {
  effectiveWindow: {
    startIso: '2027-02-08T13:45:00.000Z',
    endIso: '2027-02-08T15:45:00.000Z',
  },
  sourceAppointmentIds: [1, 2],
};
const soleilApptWindow = {
  startIso: '2027-02-08T14:25:00.000Z',
  endIso: '2027-02-08T16:25:00.000Z',
};
const withoutPrefer = resolveArrivalWindowIsos({
  apptEffectiveWindow: soleilApptWindow,
  household,
  practiceTz: 'America/New_York',
});
assert(
  withoutPrefer?.startIso === soleilApptWindow.startIso,
  'default priority still prefers per-appt window'
);
const withPrefer = resolveArrivalWindowIsos({
  apptEffectiveWindow: soleilApptWindow,
  household,
  practiceTz: 'America/New_York',
  preferHouseholdWindow: true,
});
assert(
  withPrefer?.startIso === household.effectiveWindow.startIso &&
    withPrefer?.endIso === household.effectiveWindow.endIso,
  'multi-pet preferHouseholdWindow uses shared household band'
);

const bump = {
  appointmentId: 1,
  appointmentStart: '2027-02-08T14:00:00.000Z',
  appointmentEnd: '2027-02-08T14:30:00.000Z',
};
const patches = expandPreFirstNeighborBumpToHousehold({
  bump,
  appointments: [
    {
      id: 1,
      client: { id: 99 },
      appointmentStart: '2027-02-08T13:45:00.000Z',
      appointmentEnd: '2027-02-08T14:15:00.000Z',
    },
    {
      id: 2,
      client: { id: 99 },
      appointmentStart: '2027-02-08T13:45:00.000Z',
      appointmentEnd: '2027-02-08T14:15:00.000Z',
    },
  ],
  practiceTz: 'America/New_York',
});
assert(patches.length === 2, 'PRE-FIRST bump expands to both household pets');
assert(
  patches.every((p) => p.appointmentStart === bump.appointmentStart),
  'household siblings share the bumped start'
);

if (failed) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log('\nAll household drive clump / shared window smokes passed.');

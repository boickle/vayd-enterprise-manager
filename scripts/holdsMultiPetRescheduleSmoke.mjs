/**
 * Smoke: Holds Reschedule must attach sibling household holds (any date) so
 * selecting those pets in Routing moves every matching hold — not only the
 * clicked row.
 *
 * Repro (bugs-scout): Emily Heindl — Daisy+Beverly on Oct 29, Sylvia on Dec 3.
 * Staff selected all three pets in Get Best Route; only Sylvia moved.
 *
 * Run: node scripts/holdsMultiPetRescheduleSmoke.mjs
 */

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/** Mirrors holdListItemsToRescheduleVisits in holdsOpenInScheduler.ts */
function holdListItemsToRescheduleVisits(holds) {
  const byPatient = new Map();
  const noPatient = [];

  for (const h of holds) {
    if (typeof h.id !== 'number' || !Number.isFinite(h.id) || h.id <= 0) continue;
    if (h.allDay) continue;
    const patientId = h.patient?.id != null ? String(h.patient.id) : '';
    const typeRaw = h.appointmentType?.id;
    const appointmentTypeId =
      typeRaw != null && Number.isFinite(Number(typeRaw)) ? Number(typeRaw) : undefined;
    const appointmentTypeName =
      h.appointmentType?.prettyName?.trim() ||
      h.appointmentType?.name?.trim() ||
      undefined;
    const visit = {
      appointmentId: h.id,
      patientId,
      patientName: h.patient?.name?.trim() || undefined,
      appointmentTypeId,
      appointmentTypeName,
      description: h.description ?? null,
    };
    if (!patientId) {
      noPatient.push(visit);
      continue;
    }
    if (!byPatient.has(patientId)) byPatient.set(patientId, visit);
  }

  const out = [...byPatient.values()].sort((a, b) =>
    (a.patientName ?? a.patientId).localeCompare(b.patientName ?? b.patientId, undefined, {
      sensitivity: 'base',
    })
  );
  const seenAppt = new Set(out.map((v) => v.appointmentId));
  for (const v of noPatient) {
    if (seenAppt.has(v.appointmentId)) continue;
    seenAppt.add(v.appointmentId);
    out.push(v);
  }
  return out;
}

/** Mirrors mergeRescheduleSameDayVisits */
function mergeRescheduleSameDayVisits(...lists) {
  const byPatient = new Map();
  const noPatient = [];
  const seenNoPatientAppt = new Set();

  for (const list of lists) {
    for (const v of list) {
      const patientId = String(v.patientId ?? '').trim();
      if (!patientId) {
        if (seenNoPatientAppt.has(v.appointmentId)) continue;
        seenNoPatientAppt.add(v.appointmentId);
        noPatient.push(v);
        continue;
      }
      if (!byPatient.has(patientId)) byPatient.set(patientId, v);
    }
  }

  const out = [...byPatient.values()].sort((a, b) =>
    (a.patientName ?? a.patientId).localeCompare(b.patientName ?? b.patientId, undefined, {
      sensitivity: 'base',
    })
  );
  out.push(...noPatient);
  return out;
}

/** Mirrors rescheduleTargetsForChipSelection */
function rescheduleTargetsForChipSelection(intent, selectedPatientIds) {
  const selected = new Set(selectedPatientIds.map(String));
  const sameDay = intent.sameDayVisits ?? [];
  const visits = sameDay.filter((v) => selected.has(String(v.patientId)));

  if (visits.length === 0) {
    const scope = intent.rescheduleScope ?? 'selected_pet';
    if (scope === 'household_day' && sameDay.length > 0) {
      return {
        appointmentIds: [...new Set(sameDay.map((v) => v.appointmentId))],
        patientId: intent.patientId,
        visits: sameDay,
      };
    }
    return {
      appointmentIds: [intent.appointmentId],
      patientId: intent.patientId,
      visits: sameDay.filter((v) => v.appointmentId === intent.appointmentId),
    };
  }

  if (visits.length === sameDay.length && visits.length > 1) {
    return {
      appointmentIds: [...new Set(visits.map((v) => v.appointmentId))],
      patientId: intent.patientId,
      visits,
    };
  }

  if (visits.length === 1) {
    const v = visits[0];
    return { appointmentIds: [v.appointmentId], patientId: v.patientId, visits: [v] };
  }

  return {
    appointmentIds: [...new Set(visits.map((v) => v.appointmentId))],
    patientId: (visits.find((v) => v.patientId === intent.patientId) ?? visits[0]).patientId,
    visits,
  };
}

function baseHold(overrides) {
  return {
    id: 1,
    appointmentStart: '2026-10-29T14:15:00.000Z',
    appointmentEnd: '2026-10-29T15:15:00.000Z',
    allDay: false,
    holdPlacedAtIso: '2026-07-31T16:29:00.000Z',
    appointmentType: { id: 10, name: 'HOLD - 1 hour', prettyName: 'HOLD - 1 hour' },
    client: { id: 9001, firstName: 'Emily', lastName: 'Heindl' },
    patient: null,
    primaryProvider: { id: 42, firstName: 'Hailey', lastName: 'Lloyd' },
    createdByEmployee: null,
    holdOwner: null,
    holdOwnerAssignedAt: null,
    ownerBucket: 'me',
    effectiveOwnerEmployeeId: 1,
    ownerIsCurrentUser: true,
    source: 'manual',
    description: null,
    instructions: null,
    pimsId: null,
    appointmentRequestSubmissionId: null,
    forwardBooking: null,
    ...overrides,
  };
}

const daisy = baseHold({
  id: 101,
  patient: { id: 501, name: 'Daisy' },
  description: 'Annual, rv - trying to get all 3 kitties on the same schedule for appts',
});
const beverly = baseHold({
  id: 102,
  patient: { id: 502, name: 'Beverly' },
  description: 'Annual, rv - trying to get all 3 kitties on the same schedule for appts',
});
const sylvia = baseHold({
  id: 103,
  appointmentStart: '2026-12-03T19:25:00.000Z',
  appointmentEnd: '2026-12-03T20:25:00.000Z',
  patient: { id: 503, name: 'Sylvia' },
  description: null,
});

const household = [daisy, beverly, sylvia];

// --- Bug: only the clicked hold was attached; chip-selecting siblings moved nothing ---
const clickedOnlyVisits = holdListItemsToRescheduleVisits([sylvia]);
assert(clickedOnlyVisits.length === 1, 'clicked-only should be Sylvia alone');
const brokenIntent = {
  appointmentId: sylvia.id,
  patientId: String(sylvia.patient.id),
  sameDayVisits: clickedOnlyVisits,
  rescheduleScope: 'selected_pet',
};
const brokenTargets = rescheduleTargetsForChipSelection(brokenIntent, [
  '501',
  '502',
  '503',
]);
assert(
  brokenTargets.appointmentIds.length === 1 && brokenTargets.appointmentIds[0] === 103,
  'pre-fix: selecting all three pets still only moves Sylvia'
);

// --- Fix: household holds become sameDayVisits; selecting all three moves all three ---
const holdVisits = holdListItemsToRescheduleVisits(household);
assert(holdVisits.length === 3, 'household should yield 3 visit targets');
assert(
  new Set(holdVisits.map((v) => v.appointmentId)).size === 3,
  'three distinct appointment ids'
);

const fixedIntent = {
  appointmentId: sylvia.id,
  patientId: String(sylvia.patient.id),
  sameDayVisits: mergeRescheduleSameDayVisits(holdVisits, []),
  rescheduleScope: 'household_day',
};
assert(fixedIntent.sameDayVisits.length === 3, 'merged visits include all household holds');

const allSelected = rescheduleTargetsForChipSelection(fixedIntent, ['501', '502', '503']);
assert(
  allSelected.appointmentIds.sort((a, b) => a - b).join(',') === '101,102,103',
  `selecting all three pets must move Daisy+Beverly+Sylvia, got ${allSelected.appointmentIds}`
);

const sylviaOnly = rescheduleTargetsForChipSelection(fixedIntent, ['503']);
assert(
  sylviaOnly.appointmentIds.length === 1 && sylviaOnly.appointmentIds[0] === 103,
  'deselecting siblings still moves only Sylvia'
);

const oct29Pair = rescheduleTargetsForChipSelection(fixedIntent, ['501', '502']);
assert(
  oct29Pair.appointmentIds.sort((a, b) => a - b).join(',') === '101,102',
  'selecting Daisy+Beverly moves both Oct 29 holds'
);

// Same-slot Oct 29 reschedule (no Sylvia) still attaches both pets in the slot
const oct29Visits = holdListItemsToRescheduleVisits([daisy, beverly]);
const oct29Intent = {
  appointmentId: daisy.id,
  patientId: String(daisy.patient.id),
  sameDayVisits: oct29Visits,
  rescheduleScope: 'household_day',
};
const oct29Targets = rescheduleTargetsForChipSelection(oct29Intent, ['501', '502']);
assert(
  oct29Targets.appointmentIds.sort((a, b) => a - b).join(',') === '101,102',
  'Oct 29 multi-pet slot moves both holds'
);

console.log('holdsMultiPetRescheduleSmoke: ok');

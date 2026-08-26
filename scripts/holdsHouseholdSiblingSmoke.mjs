/**
 * Smoke checks: Holds board must connect sibling holds for the same client/patient
 * across ownership filters and for unlinked online-booking titles.
 * Run: node scripts/holdsHouseholdSiblingSmoke.mjs
 *
 * Mirrors src/utils/holdsHousehold.ts + holdsDisplay online-booking parse.
 */

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function parseOnlineBookingHoldDescription(text) {
  const trimmed = String(text ?? '').trim();
  if (!/^Online Booking/i.test(trimmed)) return null;

  const existingClientHold = trimmed.match(
    /^Online Booking\s*-\s*(.+?)\s*\(\s*Current client\s*\)(?:\s+for\s+(.+?))?\s*$/i
  );
  if (existingClientHold) {
    return {
      clientName: existingClientHold[1]?.trim() || null,
      petName: existingClientHold[2]?.trim() || null,
    };
  }

  const newClientHold = trimmed.match(
    /^Online Booking\s*-\s*(.+?)(?:\.\s*([A-Za-z0-9][A-Za-z0-9' -]{0,40}?)(?::|\.)|\s*,\s*([A-Za-z0-9][A-Za-z0-9' -]{0,40}?))(?:\s|$)/i
  );
  if (newClientHold) {
    return {
      clientName: newClientHold[1]?.trim() || null,
      petName: (newClientHold[2] ?? newClientHold[3])?.trim() || null,
    };
  }

  const clientOnly = trimmed.match(/^Online Booking\s*-\s*(.+?)\s*$/i);
  if (clientOnly) {
    return { clientName: clientOnly[1]?.trim() || null, petName: null };
  }
  return null;
}

function normalizeHoldClientKey(label) {
  return label.trim().toLowerCase().replace(/\s+/g, ' ');
}

function holdClientId(h) {
  const id = h.client?.id;
  return id == null ? null : String(id);
}

function holdPatientId(h) {
  const id = h.patient?.id;
  return id == null ? null : String(id);
}

function holdClientLabel(h) {
  if (!h.client) return '';
  return `${h.client.firstName ?? ''} ${h.client.lastName ?? ''}`.trim();
}

function holdSoftClientKey(h) {
  const linked = holdClientLabel(h);
  if (linked) return normalizeHoldClientKey(linked);
  const parsed = parseOnlineBookingHoldDescription(h.description ?? '');
  const fromDesc = parsed?.clientName?.trim();
  if (fromDesc) return normalizeHoldClientKey(fromDesc);
  return null;
}

function holdMatchesOwnerFilter(hold, owner) {
  if (owner === 'all') return true;
  if (owner === 'me') return hold.ownerIsCurrentUser;
  const isUnassignedBucket =
    hold.ownerBucket === 'unassigned' || hold.ownerBucket === 'non_cl_unassigned';
  if (owner === 'unassigned') return isUnassignedBucket;
  if (owner === 'me_unassigned') return hold.ownerIsCurrentUser || isUnassignedBucket;
  return hold.effectiveOwnerEmployeeId === owner || hold.holdOwner?.id === owner;
}

function filterHoldHouseholdGroupsByOwner(groups, owner) {
  if (owner === 'all') return [...groups];
  return groups.filter((g) => g.holds.some((h) => holdMatchesOwnerFilter(h, owner)));
}

function samePracticeDay(isoA, isoB) {
  return String(isoA).slice(0, 10) === String(isoB).slice(0, 10);
}

function groupHoldsByClientHousehold(holds) {
  const sorted = [...holds].sort((a, b) => a.id - b.id);
  const byClient = new Map();
  const unlinked = [];

  for (const h of sorted) {
    const cid = holdClientId(h);
    if (cid) {
      const list = byClient.get(cid) ?? [];
      list.push(h);
      byClient.set(cid, list);
    } else {
      unlinked.push(h);
    }
  }

  const softKeyToClientId = new Map();
  const patientIdToClientId = new Map();
  for (const [cid, clientHolds] of byClient) {
    for (const h of clientHolds) {
      const soft = holdSoftClientKey(h);
      if (soft && !softKeyToClientId.has(soft)) softKeyToClientId.set(soft, cid);
      const pid = holdPatientId(h);
      if (pid && !patientIdToClientId.has(pid)) patientIdToClientId.set(pid, cid);
    }
  }

  const stillUnlinked = [];
  for (const h of unlinked) {
    const soft = holdSoftClientKey(h);
    const pid = holdPatientId(h);
    const targetCid =
      (soft ? softKeyToClientId.get(soft) : undefined) ??
      (pid ? patientIdToClientId.get(pid) : undefined) ??
      null;
    if (targetCid) {
      const list = byClient.get(targetCid) ?? [];
      list.push(h);
      byClient.set(targetCid, list);
    } else {
      stillUnlinked.push(h);
    }
  }

  const groups = [];
  for (const [cid, clientHolds] of byClient) {
    groups.push({ key: `client:${cid}`, holds: clientHolds });
  }

  const bySoftKey = new Map();
  const noSoftIdentity = [];
  for (const h of stillUnlinked) {
    const soft = holdSoftClientKey(h);
    if (soft) {
      const list = bySoftKey.get(soft) ?? [];
      list.push(h);
      bySoftKey.set(soft, list);
    } else {
      noSoftIdentity.push(h);
    }
  }

  for (const [soft, softHolds] of bySoftKey) {
    groups.push({ key: `soft:${soft}`, holds: softHolds });
  }

  for (const h of noSoftIdentity) {
    groups.push({ key: `unlinked:${h.id}`, holds: [h] });
  }

  return groups;
}

function baseHold(overrides) {
  return {
    id: 1,
    appointmentStart: '2026-09-18T18:10:00.000Z',
    appointmentEnd: '2026-09-18T20:10:00.000Z',
    allDay: false,
    holdPlacedAtIso: '2026-08-18T01:48:00.000Z',
    appointmentType: null,
    client: null,
    patient: null,
    primaryProvider: null,
    createdByEmployee: null,
    holdOwner: null,
    holdOwnerAssignedAt: null,
    ownerBucket: 'unassigned',
    effectiveOwnerEmployeeId: null,
    ownerIsCurrentUser: false,
    source: 'appointment_request',
    description: null,
    instructions: null,
    pimsId: null,
    appointmentRequestSubmissionId: null,
    forwardBooking: null,
    ...overrides,
  };
}

// --- Case: linked explore-alt hold (Mine) + unlinked online autobook (Unassigned) ---
const linkedMine = baseHold({
  id: 2201,
  appointmentStart: '2026-09-10T18:10:00.000Z',
  appointmentEnd: '2026-09-10T20:10:00.000Z',
  client: {
    id: 55,
    firstName: 'Christina',
    lastName: 'Conant',
    phone1: '+12072518140',
    email: 'christielynnec@gmail.com',
    address1: null,
    city: null,
    state: null,
    zipcode: null,
  },
  patient: { id: 901, name: 'Max' },
  ownerBucket: 'owned',
  ownerIsCurrentUser: true,
  effectiveOwnerEmployeeId: 7,
  holdOwner: { id: 7, firstName: 'Morgan', lastName: 'S' },
  description: 'Online Booking - Christina Conant. Max: We would like to have him groomed',
});

const unlinkedAutobook = baseHold({
  id: 1105,
  appointmentStart: '2026-09-18T18:10:00.000Z',
  appointmentEnd: '2026-09-18T20:10:00.000Z',
  ownerBucket: 'unassigned',
  ownerIsCurrentUser: false,
  description:
    'Online Booking - Christina Conant. Max: We would like to have him groomed, but he needs to have a rabies vaccine.',
});

assert(
  !samePracticeDay(linkedMine.appointmentStart, unlinkedAutobook.appointmentStart),
  'fixture uses different days (explore alternatives moved the slot)'
);

const allGroups = groupHoldsByClientHousehold([linkedMine, unlinkedAutobook]);
assert(allGroups.length === 1, `expected 1 household group, got ${allGroups.length}`);
assert(allGroups[0].holds.length === 2, 'both holds must share one client card');
assert(allGroups[0].key === 'client:55', `expected client:55 key, got ${allGroups[0].key}`);

const mineOnlyApi = [linkedMine]; // old Mine filter response — sibling missing
const oldMineGroups = groupHoldsByClientHousehold(mineOnlyApi);
assert(oldMineGroups.length === 1 && oldMineGroups[0].holds.length === 1, 'pre-fix Mine saw only one hold');

const mineView = filterHoldHouseholdGroupsByOwner(allGroups, 'me');
assert(mineView.length === 1, 'Mine filter keeps group when any hold is mine');
assert(mineView[0].holds.length === 2, 'Mine view must still show unassigned sibling');

const unassignedView = filterHoldHouseholdGroupsByOwner(allGroups, 'unassigned');
assert(unassignedView.length === 1, 'Unassigned filter keeps group when any hold is unassigned');
assert(unassignedView[0].holds.length === 2, 'Unassigned view must still show assigned sibling');

const otherOwnerOnly = groupHoldsByClientHousehold([
  baseHold({
    id: 99,
    client: {
      id: 88,
      firstName: 'Other',
      lastName: 'Client',
      phone1: null,
      email: null,
      address1: null,
      city: null,
      state: null,
      zipcode: null,
    },
    ownerBucket: 'owned',
    ownerIsCurrentUser: false,
    effectiveOwnerEmployeeId: 99,
  }),
]);
assert(
  filterHoldHouseholdGroupsByOwner(otherOwnerOnly, 'me').length === 0,
  'Mine must not show unrelated owned-by-others groups'
);

// --- Case: two unlinked online holds, different days, same client name ---
const earlyUnlinked = baseHold({
  id: 1,
  appointmentStart: '2026-09-05T15:00:00.000Z',
  appointmentEnd: '2026-09-05T17:00:00.000Z',
  description: 'Online Booking - Christina Conant. Max: moved earlier',
});
const lateUnlinked = baseHold({
  id: 2,
  appointmentStart: '2026-09-18T18:10:00.000Z',
  appointmentEnd: '2026-09-18T20:10:00.000Z',
  description: 'Online Booking - Christina Conant. Max: original autobook',
});
const softGroups = groupHoldsByClientHousehold([earlyUnlinked, lateUnlinked]);
assert(softGroups.length === 1, 'soft name groups unlinked holds across dates');
assert(softGroups[0].key.startsWith('soft:'), 'soft group key');
assert(softGroups[0].holds.length === 2, 'both unlinked holds connected');

console.log('holdsHouseholdSiblingSmoke: ok');

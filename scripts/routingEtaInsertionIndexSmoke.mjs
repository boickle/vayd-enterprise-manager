/**
 * Smoke checks: slot-search insertionIndex is routable-client relative; doctor-day /
 * ETA lists also include meetings/blocks. Mapping must place end-of-day after Seaver.
 *
 * Run: node scripts/routingEtaInsertionIndexSmoke.mjs
 */

function finiteNumber(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(+v)) return +v;
  return undefined;
}

function householdCountsForRoutingInsertionIndex(h) {
  if (h.isPreview) return false;
  if (h.isPersonalBlock) return false;
  return true;
}

function mapRoutableInsertionIndexToFullIndex(existing, insertionIndex, counts = householdCountsForRoutingInsertionIndex) {
  const n = existing.length;
  if (n === 0) return 0;
  const raw = finiteNumber(insertionIndex);
  const desired = raw !== undefined ? Math.max(0, Math.floor(raw)) : 0;
  const routableIdxs = [];
  for (let i = 0; i < n; i++) {
    if (counts(existing[i])) routableIdxs.push(i);
  }
  if (routableIdxs.length === 0) {
    return Math.max(0, Math.min(n, desired));
  }
  const amongRoutable = Math.max(0, Math.min(routableIdxs.length, desired));
  if (amongRoutable >= routableIdxs.length) {
    return routableIdxs[routableIdxs.length - 1] + 1;
  }
  return routableIdxs[amongRoutable];
}

function orderHouseholdsWithCandidateAtInsertion(households, insertionIndex) {
  const existing = households.filter((h) => !h.isPreview);
  const virtualH = households.find((h) => h.isPreview);
  const sortedExisting = [...existing].sort(
    (a, b) => (a.firstApptIndex ?? 999) - (b.firstApptIndex ?? 999)
  );
  const fullIns = mapRoutableInsertionIndexToFullIndex(sortedExisting, insertionIndex);
  return virtualH != null
    ? [...sortedExisting.slice(0, fullIns), virtualH, ...sortedExisting.slice(fullIns)]
    : sortedExisting;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// Repro from bugs-scout: Meeting + Dostie + Seaver; end-of-day Visit #3 (insertionIndex 2)
const existing = [
  { key: 'meeting', isPersonalBlock: true, firstApptIndex: 0 },
  { key: 'dostie', isPersonalBlock: false, firstApptIndex: 1 },
  { key: 'seaver', isPersonalBlock: false, firstApptIndex: 2 },
];
assert(
  mapRoutableInsertionIndexToFullIndex(existing, 2) === 3,
  'end-of-day among 2 clients maps after Seaver (not before)'
);
assert(
  mapRoutableInsertionIndexToFullIndex(existing, 0) === 1,
  'PRE-FIRST maps before first client (after Meeting)'
);
assert(
  mapRoutableInsertionIndexToFullIndex(existing, 1) === 2,
  'second-slot maps before Seaver'
);

const withPreview = [
  ...existing,
  { key: 'wells', isPreview: true, isPersonalBlock: false, firstApptIndex: 99 },
];
const orderedLast = orderHouseholdsWithCandidateAtInsertion(withPreview, 2);
assert(
  orderedLast.map((h) => h.key).join(',') === 'meeting,dostie,seaver,wells',
  'orderHouseholds end-of-day keeps Seaver before Wells'
);
assert(
  orderedLast.findIndex((h) => h.isPreview) === 3,
  'preview index in ordered payload is 3'
);

const orderedFirst = orderHouseholdsWithCandidateAtInsertion(withPreview, 0);
assert(
  orderedFirst.map((h) => h.key).join(',') === 'meeting,wells,dostie,seaver',
  'orderHouseholds PRE-FIRST keeps Meeting before Wells'
);

// No blocks: identity mapping
const clientsOnly = [
  { key: 'a', isPersonalBlock: false, firstApptIndex: 0 },
  { key: 'b', isPersonalBlock: false, firstApptIndex: 1 },
];
assert(mapRoutableInsertionIndexToFullIndex(clientsOnly, 0) === 0, 'no-block first');
assert(mapRoutableInsertionIndexToFullIndex(clientsOnly, 2) === 2, 'no-block append');
assert(
  orderHouseholdsWithCandidateAtInsertion(
    [...clientsOnly, { key: 'new', isPreview: true, firstApptIndex: 9 }],
    2
  )
    .map((h) => h.key)
    .join(',') === 'a,b,new',
  'no-block last order'
);

// Doctor-day appt inject mapping (blocks via predicate)
const appts = [
  { id: 1, isPersonalBlock: true },
  { id: 2, isPersonalBlock: false },
  { id: 3, isPersonalBlock: false },
];
const injectAt = mapRoutableInsertionIndexToFullIndex(
  appts,
  2,
  (a) => !a.isPersonalBlock && !a.isPreview
);
assert(injectAt === 3, 'appt inject end-of-day after last client');

console.log('routingEtaInsertionIndexSmoke: ok');

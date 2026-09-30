/**
 * Smoke: Room Loader should pitch membership savings for non-member pets even when
 * another household pet is already a member (mixed household).
 *
 * Bug (internal-scout 1790628379.934139): Greta member + Atlas/Ginger non-members —
 * summary hid “Expand to see how membership could change your bill” because any
 * member on the form suppressed the whole upsell.
 *
 * Run: node scripts/roomLoaderMixedHouseholdMembershipUpsellSmoke.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

/** Mirror of patientHasMembershipFlag-style row check used by room loader. */
function patientHasMembership(p) {
  return !!(p?.hasMembership || p?.patient?.hasMembership || p?.membershipName || p?.patient?.membershipName);
}

/** Mirror of roomLoaderPetEligibleForMultiPetMembershipUpsell. */
function petEligibleForMultiPetUpsell(patient, allPatients) {
  if (patientHasMembership(patient)) return false;
  const pid = Number(patient?.patientId ?? patient?.id);
  if (Number.isNaN(pid)) return false;
  return allPatients.some((other) => {
    const oid = Number(other?.patientId ?? other?.id);
    if (Number.isNaN(oid) || oid === pid) return false;
    return patientHasMembership(other);
  });
}

/** Non-member pets keep plans; members are excluded from upsell list. */
function availablePlansForPets(patients) {
  return patients
    .filter((p) => !patientHasMembership(p))
    .map((p) => ({ patientId: Number(p.patientId ?? p.id), patientName: p.patientName ?? p.name }));
}

/**
 * Mirror of mixed-household footer: keep existing members’ current totals,
 * replace only upsell pets’ original visit with simulated member pricing.
 */
function estimatedDueWithMembershipMixed(opts) {
  const { canonicalGrandTotal, upsellSims, householdHasExistingMember } = opts;
  let sumMemberVisit = 0;
  let sumOriginalVisit = 0;
  let storeTax = null;
  for (const sim of upsellSims) {
    sumMemberVisit += Number(sim.withMembershipVisitSubtotal) - Number(sim.multiPetCreditUsd || 0);
    sumOriginalVisit += Number(sim.originalVisitSubtotal);
    const st = Math.max(0, Number(sim.originalTotal) - Number(sim.originalVisitSubtotal));
    if (storeTax === null) storeTax = st;
  }
  if (householdHasExistingMember) {
    return canonicalGrandTotal - sumOriginalVisit + sumMemberVisit;
  }
  return sumMemberVisit + (storeTax ?? 0);
}

/** Should show membership bill explainer / simulate when any non-member pet has plans. */
function shouldShowMembershipUpsell({ readOnly, visitIsQOL, availablePlansCount }) {
  return !readOnly && !visitIsQOL && availablePlansCount > 0;
}

// --- Scenario: Deirdre Frey — Greta member, Atlas + Ginger not ---
const patients = [
  { patientId: 1, patientName: 'Atlas', hasMembership: false },
  { patientId: 2, patientName: 'Ginger', hasMembership: false },
  { patientId: 3, patientName: 'Greta Bumblebee', hasMembership: true, membershipName: 'Foundations' },
];

const plans = availablePlansForPets(patients);
assert(plans.length === 2, `expected 2 upsell pets, got ${plans.length}`);
assert(
  plans.every((p) => p.patientName !== 'Greta Bumblebee'),
  'member pet must not appear in available plans'
);
assert(
  shouldShowMembershipUpsell({ readOnly: false, visitIsQOL: false, availablePlansCount: plans.length }),
  'mixed household with non-members must show membership upsell'
);
assert(
  !shouldShowMembershipUpsell({ readOnly: false, visitIsQOL: false, availablePlansCount: 0 }),
  'all-member household must not show membership upsell'
);

assert(petEligibleForMultiPetUpsell(patients[0], patients), 'Atlas should get multi-pet credit blurb');
assert(petEligibleForMultiPetUpsell(patients[1], patients), 'Ginger should get multi-pet credit blurb');
assert(!petEligibleForMultiPetUpsell(patients[2], patients), 'Greta (member) is not an upsell target');

// Footer: Greta already at member price in grand total; Atlas+Ginger full price swapped to member sim.
const gretaMemberPortion = 400;
const atlasOriginal = 350;
const gingerOriginal = 300;
const storeTax = 0;
const canonicalGrandTotal = gretaMemberPortion + atlasOriginal + gingerOriginal + storeTax; // 1050
const due = estimatedDueWithMembershipMixed({
  canonicalGrandTotal,
  householdHasExistingMember: true,
  upsellSims: [
    {
      originalVisitSubtotal: atlasOriginal,
      withMembershipVisitSubtotal: 200,
      originalTotal: atlasOriginal,
      multiPetCreditUsd: 75,
    },
    {
      originalVisitSubtotal: gingerOriginal,
      withMembershipVisitSubtotal: 180,
      originalTotal: gingerOriginal,
      multiPetCreditUsd: 75,
    },
  ],
});
// 1050 - 350 - 300 + (200-75) + (180-75) = 630
assert(due === 630, `mixed footer due expected 630, got ${due}`);

const allNonMemberDue = estimatedDueWithMembershipMixed({
  canonicalGrandTotal: 650,
  householdHasExistingMember: false,
  upsellSims: [
    {
      originalVisitSubtotal: 600,
      withMembershipVisitSubtotal: 400,
      originalTotal: 650,
      multiPetCreditUsd: 0,
    },
  ],
});
assert(allNonMemberDue === 450, `all-non-member due expected 450 (400+50 store), got ${allNonMemberDue}`);

// Source guards: must not suppress upsell when any pet already has membership.
const formSrc = read('src/pages/PublicRoomLoaderForm.tsx');
assert(
  !formSrc.includes('roomLoaderHasAnyPetWithMembership'),
  'roomLoaderHasAnyPetWithMembership gate must be removed so mixed households still pitch membership'
);
assert(
  formSrc.includes('Expand to see how membership could change your bill'),
  'membership explainer CTA copy must remain'
);
assert(
  formSrc.includes('canonicalGrandTotal'),
  'footer estimate must accept canonicalGrandTotal for mixed-household math'
);
assert(
  formSrc.includes('householdHasExistingMember'),
  'footer estimate must detect existing members for mixed-household math'
);
assert(
  formSrc.includes('roomLoaderPetEligibleForMultiPetMembershipUpsell'),
  'per-pet multi-pet upsell blurb helper must remain'
);

console.log('roomLoaderMixedHouseholdMembershipUpsellSmoke: ok');

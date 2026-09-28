/**
 * Smoke: Care Coverage Comparison treats Annual Wellness Visit as covered under
 * Golden/Foundations membership planning even when simulate omits a $0 adjustment
 * or renames the benefit (exam vs visit).
 *
 * Bug (internal-scout 1790629563.426959): Ginger Golden pitch showed
 * "Annual Wellness Visit" as "Not included in membership" while trip/sharps/labs
 * were covered; plan name was also duplicated around an em dash.
 *
 * Run: node --experimental-strip-types scripts/membershipCoverageCompareSmoke.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  adjustmentShowsMembershipCoverage,
  cleanDuplicatedMembershipPlanDisplayName,
  computeMissingPlanIncludedWellnessVisitCoverageDelta,
  findMembershipCoverageAdjustmentIndex,
  isPlanIncludedWellnessVisitLineName,
  membershipCoverageNamesMatch,
  normMembershipItemName,
} from '../src/utils/membershipCoverageCompare.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

// --- Unit helpers ---
assert(isPlanIncludedWellnessVisitLineName('Annual Wellness Visit'), 'annual wellness visit');
assert(isPlanIncludedWellnessVisitLineName('Annual Wellness Exam'), 'annual wellness exam');
assert(isPlanIncludedWellnessVisitLineName('Comprehensive Wellness Exam'), 'comprehensive wellness exam');
assert(!isPlanIncludedWellnessVisitLineName('Medical Visit'), 'medical visit not included');
assert(!isPlanIncludedWellnessVisitLineName('Additional Wellness Visit'), 'additional wellness not auto-included');
assert(!isPlanIncludedWellnessVisitLineName('Trip Fee'), 'trip fee is not a wellness visit line');

assert(
  membershipCoverageNamesMatch('Annual Wellness Visit', 'Annual Wellness Exam'),
  'visit/exam synonym match'
);
assert(
  membershipCoverageNamesMatch('Annual Wellness Visit', 'Annual Wellness Visit'),
  'exact match'
);
assert(
  !membershipCoverageNamesMatch('Annual Wellness Visit', 'Trip Fee'),
  'does not match unrelated lines'
);

assert(
  cleanDuplicatedMembershipPlanDisplayName(
    'Golden Only - Dog, Monthly — Golden Only - Dog, Monthly'
  ) === 'Golden Only - Dog, Monthly',
  'dedupe em-dash duplicated plan name'
);
assert(
  cleanDuplicatedMembershipPlanDisplayName('Golden Only - Dog, Monthly') ===
    'Golden Only - Dog, Monthly',
  'leave single plan name alone'
);

const adjustments = [
  {
    name: 'Trip Fee',
    patientId: 42,
    originalPrice: 65,
    adjustedPrice: 0,
    quantity: 1,
  },
  {
    name: 'Annual Wellness Exam',
    patientId: 42,
    originalPrice: 189,
    adjustedPrice: 0,
    quantity: 1,
  },
];
const used = new Set();
const visitIdx = findMembershipCoverageAdjustmentIndex(
  { name: 'Annual Wellness Visit', patientId: 42 },
  adjustments,
  used,
  42,
  normMembershipItemName
);
assert(visitIdx === 1, `fuzzy match finds wellness exam adjustment (got ${visitIdx})`);
used.add(visitIdx);
assert(adjustmentShowsMembershipCoverage(adjustments[visitIdx]), 'adjustment shows coverage');

const missingDelta = computeMissingPlanIncludedWellnessVisitCoverageDelta(
  'golden',
  42,
  [
    { name: 'Annual Wellness Visit', price: 189, quantity: 1 },
    { name: 'Trip Fee', price: 65, quantity: 1 },
  ],
  [
    {
      name: 'Trip Fee',
      patientId: 42,
      originalPrice: 65,
      adjustedPrice: 0,
      quantity: 1,
    },
  ],
  normMembershipItemName
);
assert(missingDelta === 189, `missing wellness visit delta should be 189 (got ${missingDelta})`);

const alreadyCoveredDelta = computeMissingPlanIncludedWellnessVisitCoverageDelta(
  'golden',
  42,
  [{ name: 'Annual Wellness Visit', price: 189, quantity: 1 }],
  [
    {
      name: 'Annual Wellness Exam',
      patientId: 42,
      originalPrice: 189,
      adjustedPrice: 0,
      quantity: 1,
    },
  ],
  normMembershipItemName
);
assert(alreadyCoveredDelta === 0, 'no delta when synonym adjustment already covers visit');

const foundationsDelta = computeMissingPlanIncludedWellnessVisitCoverageDelta(
  'foundations',
  7,
  [{ name: 'Annual Wellness Visit', price: 150, quantity: 1 }],
  [],
  normMembershipItemName
);
assert(foundationsDelta === 150, 'foundations also corrects missing wellness visit');

const comfortDelta = computeMissingPlanIncludedWellnessVisitCoverageDelta(
  'comfort-care',
  7,
  [{ name: 'Annual Wellness Visit', price: 150, quantity: 1 }],
  [],
  normMembershipItemName
);
assert(comfortDelta === 0, 'comfort-care does not use Foundations/Golden wellness visit heuristic');

// --- Source wiring ---
const panel = read('src/components/MembershipRecommendationPanel.tsx');
assert(
  panel.includes('computeMissingPlanIncludedWellnessVisitCoverageDelta'),
  'panel uses missing wellness visit delta'
);
assert(
  panel.includes('findMembershipCoverageAdjustmentIndex'),
  'panel uses fuzzy coverage adjustment match'
);
assert(
  panel.includes('cleanDuplicatedMembershipPlanDisplayName'),
  'panel cleans duplicated plan display names'
);
assert(
  panel.includes('isPlanIncludedWellnessVisitLineName'),
  'panel falls back to plan-included wellness coverage'
);

const form = read('src/pages/PublicRoomLoaderForm.tsx');
assert(
  form.includes('computeMissingPlanIncludedWellnessVisitCoverageDelta'),
  'room loader footer applies missing wellness visit delta'
);
assert(
  form.includes('cleanDuplicatedMembershipPlanDisplayName'),
  'room loader cleans plan display names for pets'
);

console.log('membershipCoverageCompareSmoke: ok');

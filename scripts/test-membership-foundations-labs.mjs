/**
 * Lightweight assertions for Foundations senior false-$0 helpers.
 * Run: node scripts/test-membership-foundations-labs.mjs
 */
import assert from 'node:assert/strict';
import {
  foundationsFalseZeroCorrectedUnitPrice,
  isFoundationsFalseZeroSeniorPanelCode,
  membershipLabelIsFoundationsNotGolden,
  shouldSuppressFalseIncludedWellnessForFoundations,
  seniorScreenLineNameFalseFoundationsFullCoverage,
} from '../src/utils/membershipFoundationsLabs.ts';

assert.equal(membershipLabelIsFoundationsNotGolden('Foundations — Dog Annual'), true);
assert.equal(membershipLabelIsFoundationsNotGolden('Foundation Dog'), true);
assert.equal(membershipLabelIsFoundationsNotGolden('Golden Foundations'), false);
assert.equal(membershipLabelIsFoundationsNotGolden('Golden'), false);
assert.equal(membershipLabelIsFoundationsNotGolden(null), false);

assert.equal(isFoundationsFalseZeroSeniorPanelCode('8659999'), true);
assert.equal(isFoundationsFalseZeroSeniorPanelCode('FIL8659999'), true);
assert.equal(isFoundationsFalseZeroSeniorPanelCode('FIL25659999'), true);
assert.equal(isFoundationsFalseZeroSeniorPanelCode('FIL45129999'), true);
assert.equal(isFoundationsFalseZeroSeniorPanelCode('FIL48719999'), false);
assert.equal(isFoundationsFalseZeroSeniorPanelCode('FIL48119999'), false);

assert.equal(seniorScreenLineNameFalseFoundationsFullCoverage('Senior Screen Canine'), true);
assert.equal(seniorScreenLineNameFalseFoundationsFullCoverage('Early Detection Panel'), false);

const seniorWp = {
  hasCoverage: true,
  adjustedPrice: 0,
  originalPrice: 289,
  priceAdjustedByMembership: true,
};

assert.equal(
  shouldSuppressFalseIncludedWellnessForFoundations({
    foundationsNotGolden: true,
    wellnessPlanPricing: seniorWp,
    itemCode: '8659999',
    itemName: 'Senior Screen',
  }),
  true,
  'legacy 8659999 with hasCoverage must suppress'
);

assert.equal(
  shouldSuppressFalseIncludedWellnessForFoundations({
    foundationsNotGolden: true,
    wellnessPlanPricing: seniorWp,
    itemCode: '',
    itemName: 'Senior Screen — Canine (Chem 25, CBC, T4, UA)',
  }),
  true,
  'name-only senior screen with hasCoverage must suppress'
);

assert.equal(
  shouldSuppressFalseIncludedWellnessForFoundations({
    foundationsNotGolden: true,
    wellnessPlanPricing: {
      hasCoverage: true,
      adjustedPrice: 0,
      originalPrice: 95,
      priceAdjustedByMembership: true,
    },
    itemCode: 'FIL48719999',
    itemName: 'Early Detection Panel - Canine',
  }),
  false,
  'Early Detection must remain truly included'
);

assert.equal(
  foundationsFalseZeroCorrectedUnitPrice({
    foundationsNotGolden: true,
    wellnessPlanPricing: seniorWp,
    itemCode: 'FIL25659999',
    itemName: 'Senior Screen Canine',
  }),
  289
);

assert.equal(
  shouldSuppressFalseIncludedWellnessForFoundations({
    foundationsNotGolden: false,
    wellnessPlanPricing: seniorWp,
    itemCode: 'FIL25659999',
    itemName: 'Senior Screen Canine',
  }),
  false,
  'Golden members keep senior panel coverage'
);

console.log('membershipFoundationsLabs checks passed');

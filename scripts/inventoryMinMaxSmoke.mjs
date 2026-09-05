/**
 * Smoke: default location min/max vs other-location par.
 *
 * Order list fires when default on-hand (after surplus transfers and
 * filling other locations) is at or below min. Qty brings default back to max.
 *
 * Keep in sync with src/utils/inventoryLocationTargets.ts and planStockLists.
 *
 * Run: node scripts/inventoryMinMaxSmoke.mjs
 */

function shortBy(onHand, par) {
  if (par == null || !Number.isFinite(Number(par))) return null;
  const n = Number(par) - Number(onHand);
  return n > 0 ? n : null;
}

function surplusBy(onHand, par) {
  if (par == null || !Number.isFinite(Number(par))) return null;
  const n = Number(onHand) - Number(par);
  return n > 0 ? n : null;
}

function orderQtyForDefault({ effectiveOnHand, min, max }) {
  if (min == null || !Number.isFinite(min)) return 0;
  if (Number(effectiveOnHand) > min) return 0;
  const targetMax = max != null && Number.isFinite(max) ? Number(max) : min;
  const target = Math.max(targetMax, min);
  const qty = target - Number(effectiveOnHand);
  return qty > 0 ? qty : 0;
}

function planItem({ defaultOnHand, defaultMin, defaultMax, others, otherSurplus = 0 }) {
  let remaining = 0;
  for (const loc of others) {
    remaining += shortBy(loc.onHand, loc.par) ?? 0;
  }
  const defaultExtra = surplusBy(defaultOnHand, defaultMax) ?? 0;
  const cover = Math.min(defaultExtra + otherSurplus, remaining);
  remaining -= cover;
  const givenFromDefault = Math.min(defaultExtra, cover) + remaining;
  const fillQty = others.reduce((sum, loc) => sum + (shortBy(loc.onHand, loc.par) ?? 0), 0);
  const orderQty = orderQtyForDefault({
    effectiveOnHand: defaultOnHand - givenFromDefault,
    min: defaultMin,
    max: defaultMax,
  });
  return { fillQty, orderQty, effective: defaultOnHand - givenFromDefault };
}

function assert(name, actual, expected) {
  const same = JSON.stringify(actual) === JSON.stringify(expected);
  if (!same) {
    console.error(`FAIL ${name}`, { actual, expected });
    process.exitCode = 1;
    return;
  }
  console.log(`ok  ${name}`);
}

assert('order at min, qty to max', orderQtyForDefault({ effectiveOnHand: 8, min: 8, max: 20 }), 12);
assert('above min does not order', orderQtyForDefault({ effectiveOnHand: 9, min: 8, max: 20 }), 0);
assert('no min does not order', orderQtyForDefault({ effectiveOnHand: 2, min: null, max: 20 }), 0);
assert('no max orders back to min', orderQtyForDefault({ effectiveOnHand: 3, min: 8, max: null }), 5);

assert(
  'truck short, main still above min → fill only',
  planItem({
    defaultOnHand: 12,
    defaultMin: 8,
    defaultMax: 20,
    others: [{ onHand: 1, par: 4 }],
  }),
  { fillQty: 3, orderQty: 0, effective: 9 }
);

assert(
  'truck short pulls main to min → order to max',
  planItem({
    defaultOnHand: 10,
    defaultMin: 8,
    defaultMax: 20,
    others: [{ onHand: 1, par: 4 }],
  }),
  { fillQty: 3, orderQty: 13, effective: 7 }
);

assert(
  'main already at min, trucks full → order',
  planItem({
    defaultOnHand: 5,
    defaultMin: 8,
    defaultMax: 20,
    others: [{ onHand: 4, par: 4 }],
  }),
  { fillQty: 0, orderQty: 15, effective: 5 }
);

assert(
  'par on trucks but no min → fill, no order',
  planItem({
    defaultOnHand: 5,
    defaultMin: null,
    defaultMax: 20,
    others: [{ onHand: 1, par: 4 }],
  }),
  { fillQty: 3, orderQty: 0, effective: 2 }
);

if (process.exitCode) {
  console.error('inventory min/max smoke failed');
  process.exit(1);
}
console.log('inventory min/max smoke passed');

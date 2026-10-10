/**
 * Smoke: Main can give down to 0; order when effective on-hand ≤ min (back to max).
 * Prefer Main over pulling other locations below par.
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

function spareForTransfer({ isDefault, onHand, parOrMax, allowBelowPar }) {
  const q = Math.max(0, Number(onHand) || 0);
  if (isDefault || allowBelowPar) return q;
  return surplusBy(q, parOrMax) ?? 0;
}

function orderQtyForDefault({ effectiveOnHand, min, max }) {
  if (min == null || !Number.isFinite(min)) return 0;
  if (Number(effectiveOnHand) > min) return 0;
  const targetMax = max != null && Number.isFinite(max) ? Number(max) : min;
  const target = Math.max(targetMax, min);
  const qty = target - Number(effectiveOnHand);
  return qty > 0 ? qty : 0;
}

/** Simplified one-dest planner mirroring planStockLists priority. */
function planItem({ defaultOnHand, defaultMin, defaultMax, others }) {
  let need = others.reduce((sum, loc) => sum + (shortBy(loc.onHand, loc.par) ?? 0), 0);
  let mainLeft = spareForTransfer({
    isDefault: true,
    onHand: defaultOnHand,
    parOrMax: defaultMax,
  });
  const fromMain = Math.min(mainLeft, need);
  mainLeft -= fromMain;
  need -= fromMain;

  let overParSpare = others.reduce(
    (sum, loc) =>
      sum +
      spareForTransfer({
        isDefault: false,
        onHand: loc.onHand,
        parOrMax: loc.par,
      }),
    0
  );
  const fromOver = Math.min(overParSpare, need);
  need -= fromOver;

  let belowParSpare = 0;
  if (need > 0 && mainLeft <= 0) {
    belowParSpare = others.reduce((sum, loc) => {
      const over = spareForTransfer({
        isDefault: false,
        onHand: loc.onHand,
        parOrMax: loc.par,
      });
      const all = spareForTransfer({
        isDefault: false,
        onHand: loc.onHand,
        parOrMax: loc.par,
        allowBelowPar: true,
      });
      return sum + Math.max(0, all - over);
    }, 0);
    need -= Math.min(belowParSpare, need);
  }

  const fillQty = need;
  const effective = defaultOnHand - fromMain;
  const orderQty = orderQtyForDefault({
    effectiveOnHand: effective,
    min: defaultMin,
    max: defaultMax,
  });
  return { fillQty, orderQty, effective, fromMain };
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
  'main below max still gives; stays above min → no order',
  planItem({
    defaultOnHand: 25,
    defaultMin: 10,
    defaultMax: 35,
    others: [{ onHand: 20, par: 25 }],
  }),
  { fillQty: 0, orderQty: 0, effective: 20, fromMain: 5 }
);

assert(
  'main gives below min → order to max',
  planItem({
    defaultOnHand: 12,
    defaultMin: 10,
    defaultMax: 35,
    others: [{ onHand: 0, par: 5 }],
  }),
  { fillQty: 0, orderQty: 28, effective: 7, fromMain: 5 }
);

assert(
  'main empty → uncovered fill',
  planItem({
    defaultOnHand: 0,
    defaultMin: 10,
    defaultMax: 35,
    others: [{ onHand: 0, par: 3 }],
  }),
  { fillQty: 3, orderQty: 35, effective: 0, fromMain: 0 }
);

assert(
  'prefer main over other below-par',
  planItem({
    defaultOnHand: 4,
    defaultMin: 2,
    defaultMax: 20,
    others: [
      { onHand: 1, par: 5 },
      { onHand: 3, par: 5 },
    ],
  }),
  { fillQty: 0, orderQty: 20, effective: 0, fromMain: 4 }
);

if (process.exitCode) {
  console.error('inventory min/max smoke failed');
  process.exit(1);
}
console.log('inventory min/max smoke passed');

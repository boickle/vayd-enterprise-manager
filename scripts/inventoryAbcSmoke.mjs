/**
 * Smoke: ABC class cuts and due cadence.
 * Run: node scripts/inventoryAbcSmoke.mjs
 */

function classifyByUsage(rows) {
  const out = new Map();
  const withUsage = rows
    .filter((r) => Number(r.usage) > 0)
    .sort((a, b) => Number(b.usage) - Number(a.usage) || a.id - b.id);
  const zero = rows.filter((r) => Number(r.usage) <= 0);
  const n = withUsage.length;
  const aCount = n > 0 ? Math.max(1, Math.ceil(n * 0.2)) : 0;
  const bCount = n > 0 ? Math.ceil(n * 0.3) : 0;
  withUsage.forEach((row, i) => {
    if (i < aCount) out.set(row.id, 'A');
    else if (i < aCount + bCount) out.set(row.id, 'B');
    else out.set(row.id, 'C');
  });
  for (const row of zero) out.set(row.id, 'C');
  return out;
}

function countDueAt(lastCountedAt, cls, now) {
  const days = { A: 28, B: 84, C: 182 }[cls];
  if (lastCountedAt == null) return true;
  return now.getTime() - lastCountedAt.getTime() >= days * 24 * 60 * 60 * 1000;
}

function assert(name, actual, expected) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    console.error(`FAIL ${name}`, { actual, expected });
    process.exitCode = 1;
    return;
  }
  console.log(`ok  ${name}`);
}

const ten = Array.from({ length: 10 }, (_, i) => ({
  id: i + 1,
  usage: 10 - i,
}));
const cls = classifyByUsage(ten);
assert('10 items with usage: 2 A, 3 B, 5 C', {
  A: [...cls].filter(([, v]) => v === 'A').map(([id]) => id),
  B: [...cls].filter(([, v]) => v === 'B').map(([id]) => id),
  C: [...cls].filter(([, v]) => v === 'C').map(([id]) => id),
}, { A: [1, 2], B: [3, 4, 5], C: [6, 7, 8, 9, 10] });

assert(
  'zero usage is C',
  classifyByUsage([{ id: 1, usage: 0 }, { id: 2, usage: 5 }]).get(1),
  'C'
);
assert(
  'only mover is A',
  classifyByUsage([{ id: 1, usage: 0 }, { id: 2, usage: 5 }]).get(2),
  'A'
);

const now = new Date('2026-09-04T12:00:00Z');
assert('A due after 28 days', countDueAt(new Date('2026-08-06T12:00:00Z'), 'A', now), true);
assert('A not due at 27 days', countDueAt(new Date('2026-08-08T12:00:00Z'), 'A', now), false);
assert('never counted is due', countDueAt(null, 'C', now), true);

if (process.exitCode) {
  console.error('ABC smoke failed');
  process.exit(1);
}
console.log('ABC smoke passed');

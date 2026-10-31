/**
 * Smoke checks for in-house lab forms: reference-range flagging and the seeds.
 * Run: node scripts/inHouseLabSmoke.mjs
 *
 * Bundles the real modules with esbuild so this exercises shipped code rather
 * than a copy that can drift.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const out = mkdtempSync(join(tmpdir(), 'in-house-lab-smoke-'));
const bundle = join(out, 'bundle.mjs');
const entry = join(out, 'entry.ts');

const root = new URL('..', import.meta.url).pathname;
writeFileSync(
  entry,
  `export { isLabValueAbnormal, formatLabRange } from '${root}src/utils/labValues.ts';
export { LAB_FORM_SEEDS } from '${root}src/utils/labFormSeeds.ts';
`,
);
execFileSync(
  join(root, 'node_modules/.bin/esbuild'),
  [entry, '--bundle', '--format=esm', `--outfile=${bundle}`, '--log-level=warning'],
  { stdio: 'inherit' },
);

const { isLabValueAbnormal, formatLabRange, LAB_FORM_SEEDS } = await import(bundle);

let failures = 0;
function assert(cond, label) {
  if (cond) {
    console.log(`  ok  ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL  ${label}`);
  }
}

const seedByKey = Object.fromEntries(LAB_FORM_SEEDS.map((s) => [s.seedKey, s]));
const rowNamed = (seedKey, name) =>
  seedByKey[seedKey].elements.find((e) => e.name === name);

/* ---------- snap tests must flag a positive ---------- */
// The legacy form stored these as 0..1 numerics, which meant a positive result
// sat inside the reference range and never flagged. That is the whole point.
const heartworm = rowNamed('heartworm_4dx_plus', 'Heartworm');
assert(isLabValueAbnormal(heartworm, 'Positive'), 'a positive heartworm flags');
assert(!isLabValueAbnormal(heartworm, 'Negative'), 'a negative heartworm does not flag');
assert(!isLabValueAbnormal(heartworm, ''), 'an unrun snap test does not flag');
assert(
  isLabValueAbnormal(heartworm, 'positive'),
  'flagging ignores case, so a hand-typed value still counts',
);
assert(
  heartworm.defaultValue === 'Negative',
  'snap tests default to Negative so techs only change what is abnormal',
);

for (const key of ['E. canis', 'E. ewingii', 'B. burgdorferi', 'Anaplasma spp']) {
  assert(
    isLabValueAbnormal(rowNamed('heartworm_4dx_plus', key), 'Positive'),
    `a positive ${key} flags`,
  );
}

/* ---------- numeric ranges ---------- */
const glucose = rowNamed('blood_glucose', 'BLOOD GLUCOSE');
assert(!isLabValueAbnormal(glucose, '120'), 'in-range glucose does not flag');
assert(isLabValueAbnormal(glucose, '640'), 'glucose above the max flags');
assert(isLabValueAbnormal(glucose, '-5'), 'glucose below the min flags');
assert(!isLabValueAbnormal(glucose, ''), 'a blank glucose does not flag');
assert(!isLabValueAbnormal(glucose, 'lipemic'), 'unparseable text does not flag');
assert(formatLabRange(glucose) === '0 – 500 mg/dl', 'glucose shows its range and units');

const ph = rowNamed('urine_dipstick', 'pH');
assert(isLabValueAbnormal(ph, '9'), 'urine pH above 8.5 flags');
assert(!isLabValueAbnormal(ph, '6.5'), 'normal urine pH does not flag');

const schirmer = rowNamed('schirmer_tear_test', 'OD');
assert(!isLabValueAbnormal(schirmer, '18'), 'a normal Schirmer does not flag');
assert(isLabValueAbnormal(schirmer, '45'), 'a Schirmer above 30 flags');

/* ---------- free-text rows stay quiet ---------- */
const whichEar = rowNamed('ear_cytology', 'Which ear?');
assert(whichEar.valueType === 'text', 'ear cytology asks which ear as free text');
assert(!isLabValueAbnormal(whichEar, 'AU'), 'free text never flags');
assert(formatLabRange(whichEar) === '', 'a row with no range shows no range');

/* ---------- seed integrity ---------- */
assert(LAB_FORM_SEEDS.length === 9, 'all nine in-house forms are seeded');
assert(
  new Set(LAB_FORM_SEEDS.map((s) => s.seedKey)).size === LAB_FORM_SEEDS.length,
  'seed keys are unique, so re-seeding updates instead of duplicating',
);
assert(
  LAB_FORM_SEEDS.every((s) => s.name && s.category),
  'every seeded form has a name and a category',
);
assert(
  seedByKey.urinalysis.mode === 'summary' && !seedByKey.urinalysis.elements.length,
  'urinalysis is a written summary with no rows',
);
assert(
  LAB_FORM_SEEDS.filter((s) => s.mode !== 'summary').every((s) => s.elements.length),
  'every table-style form has at least one row',
);
assert(
  LAB_FORM_SEEDS.every((s) => s.elements.every((e) => e.name.trim())),
  'no seeded row is missing its name',
);
assert(
  seedByKey.urine_dipstick_sediment.elements.length >
    seedByKey.urine_dipstick.elements.length,
  'the sediment form adds rows on top of the plain dipstick',
);
assert(
  seedByKey.urine_dipstick.elements.every(
    (e) => e.valueType !== 'select' || (e.options ?? []).length,
  ),
  'no choice row is left without choices',
);
assert(
  LAB_FORM_SEEDS.every((s) =>
    s.elements.every(
      (e) => e.min == null || e.max == null || Number(e.min) <= Number(e.max),
    ),
  ),
  'no reference range is inverted',
);

rmSync(out, { recursive: true, force: true });

if (failures) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll in-house lab checks passed.');

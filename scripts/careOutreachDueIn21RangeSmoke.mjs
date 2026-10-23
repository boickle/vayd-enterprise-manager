/**
 * Smoke: Care Outreach "Due in next 21 days" chip matches diffs 1–21
 * (not only exactly day 21). When day+21 is Friday, also include 22–23.
 *
 * Repro (#internal-scout): chip showed only clients due on the single day
 * 21 days out; staff want proactive outreach for patients due in 1–21 days.
 *
 * Run: node scripts/careOutreachDueIn21RangeSmoke.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const filtersPath = path.join(root, 'src/utils/careOutreachPriorityFilters.ts');
const pagePath = path.join(root, 'src/pages/CareOutreachPage.tsx');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/** Mirrors dayDiffsForDueIn21DayBucket (dayjs weekday: 0=Sun … 5=Fri). */
function dayDiffsForDueIn21DayBucket(weekdayOfTodayPlus21) {
  const diffs = new Set();
  for (let d = 1; d <= 21; d += 1) diffs.add(d);
  if (weekdayOfTodayPlus21 === 5) {
    diffs.add(22);
    diffs.add(23);
  }
  return diffs;
}

const filters = fs.readFileSync(filtersPath, 'utf8');
const page = fs.readFileSync(pagePath, 'utf8');

assert(
  /for \(let d = 1; d <= 21; d \+= 1\) diffs\.add\(d\)/.test(filters),
  'due_21 bucket must include day diffs 1 through 21'
);
assert(
  !/return new Set\(\[21\]\)/.test(filters),
  'due_21 bucket must not be a single-day Set([21])'
);
assert(
  /Due in next 21 days/.test(page),
  'CareOutreachPage chip label must say Due in next 21 days'
);
assert(
  /next 1–21 calendar days/.test(page),
  'Chip tooltip must describe the 1–21 day window'
);

const weekday = dayDiffsForDueIn21DayBucket(3); // Wed anchor
assert(weekday.size === 21, `expected 21 diffs on non-Friday, got ${weekday.size}`);
assert(!weekday.has(0), 'must not include due today (diff 0)');
assert(weekday.has(1) && weekday.has(21), 'must include 1 and 21');
assert(!weekday.has(22) && !weekday.has(23), 'non-Friday must not include 22/23');

const friday = dayDiffsForDueIn21DayBucket(5);
assert(friday.size === 23, `expected 23 diffs when day+21 is Friday, got ${friday.size}`);
assert(friday.has(22) && friday.has(23), 'Friday anchor must include weekend diffs 22–23');

console.log('careOutreachDueIn21RangeSmoke: ok');

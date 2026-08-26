/**
 * Smoke: after confirming a hold, the converted popover must offer Done that
 * stays on the schedule (not only Back to Holds / Edit).
 *
 * Repro (bugs-scout): confirm hold → "Appointment booked" popover with only
 * Back to Holds + Edit; staff who already edited want to dismiss and remain
 * on the calendar.
 *
 * Run: node scripts/onHoldVisitConvertedDoneSmoke.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const popoverSrc = fs.readFileSync(
  path.join(root, 'src/components/OnHoldVisitConvertedPopover.tsx'),
  'utf8',
);
const schedulerSrc = fs.readFileSync(path.join(root, 'src/pages/Scheduler.tsx'), 'utf8');

assert(/onDone/.test(popoverSrc), 'popover must accept onDone');
assert(
  />\s*Done\s*</.test(popoverSrc) || />\s*\n\s*Done\s*\n/.test(popoverSrc),
  'popover must render a Done button label',
);
assert(
  /className="btn primary"[^>]*onClick=\{onDone\}|onClick=\{onDone\}[^>]*className="btn primary"/.test(
    popoverSrc.replace(/\s+/g, ' '),
  ) || /onClick=\{onDone\}/.test(popoverSrc),
  'Done must call onDone',
);
assert(/onClick=\{onBack\}/.test(popoverSrc), 'Back to Holds must still call onBack');
assert(
  /navigateBack:\s*false/.test(schedulerSrc) &&
    /completeOnHoldVisitStayOnSchedule/.test(schedulerSrc),
  'Scheduler must expose stay-on-schedule finish (navigateBack: false)',
);
assert(
  /onDone=\{completeOnHoldVisitStayOnSchedule\}/.test(schedulerSrc),
  'converted popover must wire onDone to stay-on-schedule',
);
assert(
  /onBack=\{completeOnHoldVisitReturn\}/.test(schedulerSrc),
  'converted popover must keep onBack → return to Holds',
);
assert(
  /choose Done to stay on the schedule/i.test(popoverSrc),
  'copy should mention Done stays on the schedule',
);

assert(
  /Escape.*completeOnHoldVisitStayOnSchedule|completeOnHoldVisitStayOnSchedule.*Escape/.test(
    schedulerSrc.replace(/\s+/g, ' '),
  ),
  'Escape on converted popover should stay on schedule (Done), not navigate to Holds',
);

console.log('onHoldVisitConvertedDoneSmoke: ok');

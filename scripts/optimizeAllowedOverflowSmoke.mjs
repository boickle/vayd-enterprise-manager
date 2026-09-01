/**
 * Smoke: Optimize must not offer moves past the normal schedule overflow cushion.
 *
 * Slack (#internal-scout): Optimize preview offered a slot with 15 minutes of
 * overflow; allowed cushion is ~10 minutes (not Get Best Route “Allow Overflow”).
 *
 * Run: node scripts/optimizeAllowedOverflowSmoke.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function localHmsToSeconds(hms) {
  if (typeof hms !== 'string') return undefined;
  const s = hms.trim();
  if (!s) return undefined;
  const [hh = 0, mm = 0, ss = 0] = s.split(':').map(Number);
  if ([hh, mm, ss].some((n) => Number.isNaN(n))) return undefined;
  return hh * 3600 + mm * 60 + ss;
}

function computeDepotReturnOverrunSeconds(dayData) {
  const endSec = localHmsToSeconds(dayData.endDepotTime);
  if (endSec == null) return null;
  let returnSec;
  const hms = dayData._returnLocalHms;
  if (typeof hms === 'string') returnSec = localHmsToSeconds(hms);
  if (returnSec == null) return null;
  return Math.max(0, returnSec - endSec);
}

/** Mirror of optimizeMoveExceedsAllowedOverflow (clock math only). */
function exceedsAllowedOverflow({
  appointmentEndLocalHms,
  endDepotTime,
  returnLocalHms,
  allowedOverflowMin = 10,
}) {
  const endSec = localHmsToSeconds(endDepotTime);
  const etdSec = localHmsToSeconds(appointmentEndLocalHms);
  if (endSec != null && etdSec != null && etdSec > endSec + allowedOverflowMin * 60) {
    return true;
  }
  const overrunSec = computeDepotReturnOverrunSeconds({
    endDepotTime,
    _returnLocalHms: returnLocalHms,
  });
  if (overrunSec != null && overrunSec > allowedOverflowMin * 60) return true;
  return false;
}

// Source pins the cushion at 10 minutes (was 30).
const movesSrc = fs.readFileSync(
  path.join(here, '../src/utils/scheduleOptimizeMoves.ts'),
  'utf8'
);
assert(
  /export const OPTIMIZE_ALLOWED_OVERFLOW_MIN = 10;/.test(movesSrc),
  'OPTIMIZE_ALLOWED_OVERFLOW_MIN must be 10'
);
assert(
  !/\bWORK_END_SLACK_MIN\b/.test(movesSrc),
  'legacy WORK_END_SLACK_MIN should be removed'
);
assert(
  /optimizeMoveExceedsAllowedOverflow\(/.test(movesSrc),
  'validateOneProposal must call optimizeMoveExceedsAllowedOverflow'
);

// Visit ETD 15 min past work end → reject (the Slack repro).
assert(
  exceedsAllowedOverflow({
    appointmentEndLocalHms: '15:45:00',
    endDepotTime: '15:30:00',
  }) === true,
  '15m visit overrun past 10m cushion must reject'
);

// Visit ETD exactly +10 → allow.
assert(
  exceedsAllowedOverflow({
    appointmentEndLocalHms: '15:40:00',
    endDepotTime: '15:30:00',
  }) === false,
  'exactly 10m visit overrun must allow'
);

// Visit ETD within day → allow.
assert(
  exceedsAllowedOverflow({
    appointmentEndLocalHms: '15:20:00',
    endDepotTime: '15:30:00',
  }) === false,
  'on-time visit must allow'
);

// Depot return 15 min past end → reject even when visit ends on time.
assert(
  exceedsAllowedOverflow({
    appointmentEndLocalHms: '15:20:00',
    endDepotTime: '15:30:00',
    returnLocalHms: '15:45:00',
  }) === true,
  '15m depot-return overrun must reject'
);

// Depot return exactly +10 → allow.
assert(
  exceedsAllowedOverflow({
    appointmentEndLocalHms: '15:20:00',
    endDepotTime: '15:30:00',
    returnLocalHms: '15:40:00',
  }) === false,
  'exactly 10m depot-return overrun must allow'
);

// Old 30m cushion would have allowed the Slack case; 10m must not.
assert(
  exceedsAllowedOverflow({
    appointmentEndLocalHms: '15:45:00',
    endDepotTime: '15:30:00',
    allowedOverflowMin: 30,
  }) === false,
  'sanity: 30m cushion would have allowed 15m overrun'
);

console.log('optimizeAllowedOverflowSmoke: ok');

/**
 * Smoke checks for Optimize overflow gating (normal schedule ~10 min budget).
 * Run: node scripts/optimizeAllowedOverflowSmoke.mjs
 *
 * Mirrors src/utils/scheduleOptimizeMoves.ts + depotReturnOverrun helpers.
 */

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
  if (typeof dayData.validationReturnSec === 'number' && Number.isFinite(dayData.validationReturnSec)) {
    returnSec = Math.max(0, Math.floor(dayData.validationReturnSec));
  }
  if (returnSec == null) return null;
  return Math.max(0, returnSec - endSec);
}

const OPTIMIZE_ALLOWED_OVERFLOW_MIN = 10;

function pastWorkEnd(endIso, destDay, practiceTz, slackMin = OPTIMIZE_ALLOWED_OVERFLOW_MIN) {
  // Smoke: endIso is practice-local wall clock encoded as ...T{HH:mm}:00.000Z for simplicity
  const endMatch = String(endIso).match(/T(\d{2}):(\d{2})/);
  const endHms = endMatch ? `${endMatch[1]}:${endMatch[2]}` : null;
  const endSec = localHmsToSeconds(endHms);
  const workSec = localHmsToSeconds(destDay.endDepotTime || '18:00');
  if (endSec == null || workSec == null) return false;
  return endSec > workSec + slackMin * 60;
}

function optimizeMoveExceedsAllowedOverflow(args) {
  const maxMin = args.maxOverflowMin ?? OPTIMIZE_ALLOWED_OVERFLOW_MIN;
  const overrunSec = computeDepotReturnOverrunSeconds(args.destDay);
  if (overrunSec != null && overrunSec > maxMin * 60) return true;
  return pastWorkEnd(args.movedEndIso, args.destDay, args.practiceTz, maxMin);
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const day = { date: '2026-09-03', timezone: 'America/New_York', endDepotTime: '15:30' };

// 15 min past work end (the Slack bug case) — reject
assert(
  optimizeMoveExceedsAllowedOverflow({
    movedEndIso: '2026-09-03T15:45:00.000Z',
    destDay: day,
    practiceTz: 'America/New_York',
  }) === true,
  '15m past work end exceeds 10m budget'
);

// Exactly 10 min past — allow
assert(
  optimizeMoveExceedsAllowedOverflow({
    movedEndIso: '2026-09-03T15:40:00.000Z',
    destDay: day,
    practiceTz: 'America/New_York',
  }) === false,
  'exactly 10m past work end is within budget'
);

// Old 30m slack would have allowed 15m; ensure we still reject
assert(
  optimizeMoveExceedsAllowedOverflow({
    movedEndIso: '2026-09-03T15:45:00.000Z',
    destDay: day,
    practiceTz: 'America/New_York',
    maxOverflowMin: 30,
  }) === false,
  'sanity: 15m would pass a 30m budget (old Optimize slack)'
);

// Depot-return overrun +15m via validationReturnSec — reject even if stop ends on time
assert(
  optimizeMoveExceedsAllowedOverflow({
    movedEndIso: '2026-09-03T15:20:00.000Z',
    destDay: {
      ...day,
      validationReturnSec: 15 * 3600 + 45 * 60, // 15:45
    },
    practiceTz: 'America/New_York',
  }) === true,
  'depot return +15m exceeds budget'
);

// Depot-return overrun +8m — allow
assert(
  optimizeMoveExceedsAllowedOverflow({
    movedEndIso: '2026-09-03T15:20:00.000Z',
    destDay: {
      ...day,
      validationReturnSec: 15 * 3600 + 38 * 60, // 15:38
    },
    practiceTz: 'America/New_York',
  }) === false,
  'depot return +8m within budget'
);

console.log('optimizeAllowedOverflowSmoke: ok');

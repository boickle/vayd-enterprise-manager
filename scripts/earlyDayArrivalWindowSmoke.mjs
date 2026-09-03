/**
 * Smoke checks for early-day first-stop arrival windows (no test runner / luxon).
 * Run: node scripts/earlyDayArrivalWindowSmoke.mjs
 *
 * Mirrors src/utils/earlyDayArrivalWindow.ts — Hailey Lloyd case (Sep 2026):
 * leave depot 8:30, ETA 9:00 → window 9:00–11:00 (not 8:30–10).
 * Deirdre verification (Aug 2026): slot 8:50 → 8:50–10:50 (not 7:50–9:50).
 *
 * Times are practice-local minutes from midnight (America/New_York wall clock).
 */

function parseHmm(s) {
  const [h, m] = String(s).split(':').map(Number);
  return h * 60 + (m || 0);
}

function fmtHmm(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

/** Pure mirror of earlyDayArrivalWindowFromExpectedArrival using local minutes. */
function earlyDayWindowLocal(etaMin, depotMin) {
  if (etaMin - 60 >= depotMin) return null;
  return { startMin: etaMin, endMin: etaMin + 120 };
}

/** Pure mirror of adjustedArrivalWindowForScheduledStart (±60). */
function adjustedWindowLocal(scheduledMin, depotMin, etaMin) {
  const anchor = etaMin != null ? etaMin : scheduledMin;
  const rewritten = earlyDayWindowLocal(anchor, depotMin);
  if (rewritten) return rewritten;
  return {
    startMin: Math.max(depotMin, scheduledMin - 60),
    endMin: scheduledMin + 60,
  };
}

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed += 1;
  } else {
    console.log('ok:', msg);
  }
}

const depot = parseHmm('08:30');

// Hailey: leave 8:30, arrive 9:00 → 9–11
{
  const w = earlyDayWindowLocal(parseHmm('09:00'), depot);
  assert(w != null, 'Hailey early-day rewrite applies');
  assert(fmtHmm(w.startMin) === '9:00', `Hailey start is 9:00 (got ${w && fmtHmm(w.startMin)})`);
  assert(fmtHmm(w.endMin) === '11:00', `Hailey end is 11:00 (got ${w && fmtHmm(w.endMin)})`);
}

// Deirdre: 8:50 → 8:50–10:50
{
  const w = adjustedWindowLocal(parseHmm('08:50'), depot);
  assert(w != null, '8:50 early-day window exists');
  assert(fmtHmm(w.startMin) === '8:50', `8:50 start stays 8:50 (got ${fmtHmm(w.startMin)})`);
  assert(fmtHmm(w.endMin) === '10:50', `8:50 end is 10:50 (got ${fmtHmm(w.endMin)})`);
}

// Mid-day: no rewrite
{
  const w = adjustedWindowLocal(parseHmm('14:00'), depot);
  assert(fmtHmm(w.startMin) === '13:00', `mid-day start 13:00 (got ${fmtHmm(w.startMin)})`);
  assert(fmtHmm(w.endMin) === '15:00', `mid-day end 15:00 (got ${fmtHmm(w.endMin)})`);
  assert(earlyDayWindowLocal(parseHmm('14:00'), depot) == null, 'mid-day no rewrite');
}

// Must not use legacy depot-leave → +2h for ETA 9:00
{
  const w = earlyDayWindowLocal(parseHmm('09:00'), depot);
  assert(
    !(fmtHmm(w.startMin) === '8:30' && fmtHmm(w.endMin) === '10:30'),
    'must not use depot-leave → +2h (legacy adjustedWindowForStart bug)'
  );
}

// ETA 9 with scheduled 9:30 still rewrites from ETA when provided
{
  const w = adjustedWindowLocal(parseHmm('09:30'), depot, parseHmm('09:00'));
  assert(fmtHmm(w.startMin) === '9:00', 'ETA anchor wins over scheduled for rewrite start');
  assert(fmtHmm(w.endMin) === '11:00', 'ETA anchor wins over scheduled for rewrite end');
}

if (failed) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log('\nAll smoke checks passed');

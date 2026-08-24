/**
 * Smoke checks for ASAP All Doctors result sort defaults.
 * Run: node scripts/asapResultsSortSmoke.mjs
 *
 * Mirrors helpers in src/utils/asapResultsSort.ts
 */

const ASAP_RESULTS_SORT_MODE_PREFERRED = 'score';

function resolveAsapResultsSortComparatorKind(resultsSortedByDateTime, asapResultsSortMode) {
  return resultsSortedByDateTime && asapResultsSortMode === 'datetime' ? 'datetime' : 'score';
}

function toggleAsapResultsSortMode(mode) {
  return mode === 'datetime' ? 'score' : 'datetime';
}

function asapResultsHeading(args) {
  if (!args.hasResult) return 'Results';
  if (args.resultsSortedByDateTime) {
    return resolveAsapResultsSortComparatorKind(
      args.resultsSortedByDateTime,
      args.asapResultsSortMode
    ) === 'datetime'
      ? 'Results (earliest first)'
      : 'Results (lower score is better)';
  }
  if (args.hasActiveRescheduleIntent) {
    return 'Results (lower score is better — vs. original booking)';
  }
  return 'Results (lower score is better)';
}

function asapResultsSortToggleLabel(mode) {
  return mode === 'datetime' ? 'Sort by Score (Preferred)' : 'Sort by Date & Time';
}

function sortByScore(a, b) {
  const aScore = typeof a.score === 'number' ? a.score : Number.POSITIVE_INFINITY;
  const bScore = typeof b.score === 'number' ? b.score : Number.POSITIVE_INFINITY;
  return aScore - bScore;
}

function optionStartMs(opt) {
  const iso = opt.suggestedStartIso ?? opt.arrivalWindow?.windowStartIso;
  if (!iso) return Number.POSITIVE_INFINITY;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
}

function sortByDateTime(a, b) {
  const diff = optionStartMs(a) - optionStartMs(b);
  if (diff !== 0) return diff;
  return sortByScore(a, b);
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(
  ASAP_RESULTS_SORT_MODE_PREFERRED === 'score',
  'ASAP Preferred default must be score (not earliest-first)'
);

assert(
  resolveAsapResultsSortComparatorKind(true, ASAP_RESULTS_SORT_MODE_PREFERRED) === 'score',
  'new ASAP search uses score comparator'
);
assert(
  resolveAsapResultsSortComparatorKind(true, 'datetime') === 'datetime',
  'toggle to datetime keeps earliest-first'
);
assert(
  resolveAsapResultsSortComparatorKind(false, 'datetime') === 'score',
  'non-ASAP results always sort by score'
);

assert(toggleAsapResultsSortMode('score') === 'datetime', 'score → datetime toggle');
assert(toggleAsapResultsSortMode('datetime') === 'score', 'datetime → score toggle');

assert(
  asapResultsHeading({
    hasResult: true,
    resultsSortedByDateTime: true,
    asapResultsSortMode: 'score',
    hasActiveRescheduleIntent: true,
  }) === 'Results (lower score is better)',
  'ASAP + Preferred score heading'
);
assert(
  asapResultsHeading({
    hasResult: true,
    resultsSortedByDateTime: true,
    asapResultsSortMode: 'datetime',
    hasActiveRescheduleIntent: true,
  }) === 'Results (earliest first)',
  'ASAP + datetime heading'
);
assert(
  asapResultsSortToggleLabel('score') === 'Sort by Date & Time',
  'when on Preferred score, offer datetime toggle'
);
assert(
  asapResultsSortToggleLabel('datetime') === 'Sort by Score (Preferred)',
  'when on earliest-first, offer Preferred score toggle'
);

// Madigan / Brunswick repro: HL Tue score 300.8 vs BQ Thu score 83.2
const lloyd = {
  doctorName: 'Hailey Lloyd',
  score: 300.8,
  suggestedStartIso: '2026-08-25T12:20:00-04:00',
  addedDriveMinutes: 49,
};
const quinn = {
  doctorName: 'Brian Quinn',
  score: 83.2,
  suggestedStartIso: '2026-08-27T08:45:00-04:00',
  addedDriveMinutes: 8,
};

const byDatetime = [lloyd, quinn].slice().sort(sortByDateTime);
assert(
  byDatetime[0].doctorName === 'Hailey Lloyd',
  'earliest-first wrongly elevates Lloyd (Tue) over Quinn (Thu)'
);

const byScore = [lloyd, quinn].slice().sort(sortByScore);
assert(
  byScore[0].doctorName === 'Brian Quinn',
  'Preferred score sort ranks Quinn (83.2) above Lloyd (300.8)'
);
assert(byScore[0].addedDriveMinutes === 8, 'top Preferred option is the low added-drive BQ slot');

console.log('asapResultsSortSmoke: ok');

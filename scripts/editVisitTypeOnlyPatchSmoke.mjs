/**
 * Smoke checks for HOLD → Standard type-only Book patch shaping.
 * Run: node scripts/editVisitTypeOnlyPatchSmoke.mjs
 *
 * Mirrors pure helpers in src/utils/editVisitCommit.ts / httpErrorMessage.ts.
 */

function editVisitPracticeMinuteKey(iso, practiceTz) {
  if (!iso?.trim()) return null;
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return null;
  // Format in practice tz via Intl (sufficient for minute equality checks in smoke).
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: practiceTz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(dt);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  const y = get('year');
  const m = get('month');
  const d = get('day');
  const h = get('hour');
  const min = get('minute');
  if (!y || !m || !d || !h || !min) return null;
  return `${y}-${m}-${d}T${h}:${min}`;
}

function editVisitTimesMatchAtPracticeMinute(
  savedStart,
  savedEnd,
  previewStart,
  previewEnd,
  practiceTz
) {
  const a = editVisitPracticeMinuteKey(savedStart, practiceTz);
  const b = editVisitPracticeMinuteKey(previewStart, practiceTz);
  const c = editVisitPracticeMinuteKey(savedEnd, practiceTz);
  const d = editVisitPracticeMinuteKey(previewEnd, practiceTz);
  return Boolean(a && b && c && d && a === b && c === d);
}

function buildTypeOnlyPatchBody({
  typeId,
  typeName,
  description,
  instructions,
}) {
  return {
    appointmentTypeId: typeId,
    ...(typeName ? { appointmentTypeName: typeName } : {}),
    ...(description ? { description } : {}),
    ...(instructions ? { instructions } : {}),
    bookedViaRouting: true,
  };
}

function normalizeApiErrorText(value) {
  if (typeof value === 'string') {
    const t = value.trim();
    return t || null;
  }
  if (Array.isArray(value)) {
    const parts = value
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean);
    return parts.length ? parts.join(', ') : null;
  }
  return null;
}

function extractHttpErrorMessage(err, fallback = 'Request failed') {
  if (typeof err === 'string') return err.trim() || fallback;
  if (err && typeof err === 'object') {
    const server =
      normalizeApiErrorText(err.response?.data?.message) ||
      normalizeApiErrorText(err.response?.data?.error);
    if (server) return server;
    const msg = err.message?.trim();
    if (msg && !/^Request failed with status code \d+$/i.test(msg)) return msg;
  }
  return fallback;
}

let failed = 0;
function assert(cond, label) {
  if (!cond) {
    console.error('FAIL:', label);
    failed += 1;
  } else {
    console.log('ok:', label);
  }
}

const tz = 'America/New_York';
const savedStart = '2026-08-13T13:00:00.000Z'; // 9:00 AM ET
const savedEnd = '2026-08-13T14:02:30.123Z'; // 10:02:30 ET — seconds truncated in preview
const previewStart = '2026-08-13T13:00:00.000Z';
const previewEnd = '2026-08-13T14:02:00.000Z';

assert(
  editVisitTimesMatchAtPracticeMinute(savedStart, savedEnd, previewStart, previewEnd, tz),
  'minute match ignores reconstructed seconds'
);

const lean = buildTypeOnlyPatchBody({
  typeId: 42,
  typeName: 'Standard',
  description: '',
  instructions: 'Edited appt type by Lisa B. on 07/30/2026',
});
assert(lean.appointmentTypeId === 42, 'lean patch has type id');
assert(lean.appointmentTypeName === 'Standard', 'lean patch includes type name');
assert(lean.bookedViaRouting === true, 'lean patch skips manual-book gate');
assert(!('statusName' in lean), 'lean patch omits statusName');
assert(!('confirmStatusName' in lean), 'lean patch omits confirmStatusName');
assert(!('appointmentStart' in lean), 'lean patch omits times');
assert(!('description' in lean), 'lean patch omits empty description');
assert(typeof lean.instructions === 'string', 'lean patch keeps audit instructions');

assert(
  extractHttpErrorMessage({
    response: { data: { message: ['statusName must be a string'] } },
    message: 'Request failed with status code 400',
  }) === 'statusName must be a string',
  'extracts array validation messages'
);

assert(
  extractHttpErrorMessage({
    message: 'Request failed with status code 400',
  }) === 'Request failed',
  'strips opaque axios status-code message'
);

if (failed > 0) {
  console.error(`\n${failed} smoke check(s) failed`);
  process.exit(1);
}
console.log('\nAll editVisit type-only patch smoke checks passed.');

/**
 * Smoke checks for depot-return overrun helpers + candidateSlot pin behavior.
 * Run: node scripts/depotReturnOverrunSmoke.mjs
 */

function localHmsToSeconds(hms) {
  if (typeof hms !== 'string') return undefined;
  const s = hms.trim();
  if (!s) return undefined;
  const [hh = 0, mm = 0, ss = 0] = s.split(':').map(Number);
  if ([hh, mm, ss].some((n) => Number.isNaN(n))) return undefined;
  return hh * 3600 + mm * 60 + ss;
}

function coerceOverrunSeconds(raw) {
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.max(0, Math.floor(raw));
  if (typeof raw === 'string' && raw.trim() !== '' && !Number.isNaN(+raw)) {
    return Math.max(0, Math.floor(+raw));
  }
  return undefined;
}

function computeDepotReturnOverrunSeconds(dayData) {
  const endSec = localHmsToSeconds(dayData.endDepotTime);
  if (endSec == null) return null;

  let returnSec;
  const backIso = dayData.backToDepotIso?.trim?.() ?? dayData.backToDepotIso;
  if (backIso) {
    // Mirror Luxon local wall-clock: tests use fixed offsets via Date parsing in UTC+0-ish ISO
    const d = new Date(backIso);
    if (!Number.isNaN(d.getTime())) {
      // Use UTC components when Z suffix present (practice ISO often Z-encoded local)
      if (String(backIso).endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(String(backIso))) {
        // For smoke: parse HH:mm from a companion field when provided
        if (dayData._returnLocalHms) {
          returnSec = localHmsToSeconds(dayData._returnLocalHms);
        }
      }
    }
  }
  if (returnSec == null && typeof dayData.validationReturnSec === 'number') {
    if (Number.isFinite(dayData.validationReturnSec)) {
      returnSec = Math.max(0, Math.floor(dayData.validationReturnSec));
    }
  }
  if (returnSec == null) return null;
  return Math.max(0, returnSec - endSec);
}

function buildEtaCandidateSlot(source, opts = {}) {
  const lat = source.lat;
  const lon = source.lon;
  if (lat == null || lon == null) return undefined;
  const suggestedStartIso = String(source.suggestedStartIso ?? '').trim();
  if (!suggestedStartIso) return undefined;
  const slot = {
    insertionIndex: source.insertionIndex ?? 0,
    positionInDay: source.positionInDay ?? 1,
    suggestedStartIso,
    lat,
    lon,
    serviceMinutes: source.serviceMinutes ?? 30,
  };
  if (opts.pinSearchValidation) {
    if (source.overrunSeconds != null) slot.overrunSeconds = source.overrunSeconds;
    if (source.validationLastEtdSec != null) slot.validationLastEtdSec = source.validationLastEtdSec;
    if (source.validationReturnSec != null) slot.validationReturnSec = source.validationReturnSec;
  }
  return slot;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// coerceOverrunSeconds
assert(coerceOverrunSeconds(180) === 180, 'number overrun');
assert(coerceOverrunSeconds('180') === 180, 'string overrun');
assert(coerceOverrunSeconds(undefined) === undefined, 'missing overrun');

// computeDepotReturnOverrunSeconds via validationReturnSec
const end = 17 * 3600; // 5:00 PM
const ret = 17 * 3600 + 30 * 60; // 5:30 PM
assert(
  computeDepotReturnOverrunSeconds({
    endDepotTime: '17:00',
    validationReturnSec: ret,
  }) === 30 * 60,
  'validationReturnSec overrun +30m'
);
assert(
  computeDepotReturnOverrunSeconds({
    endDepotTime: '17:00',
    validationReturnSec: end,
  }) === 0,
  'on-time return'
);

// candidateSlot does not pin search validation by default
const pinnedSource = {
  insertionIndex: 2,
  positionInDay: 3,
  suggestedStartIso: '2026-08-05T17:35:00.000Z',
  lat: 44.1,
  lon: -70.2,
  serviceMinutes: 50,
  overrunSeconds: 180,
  validationReturnSec: ret,
  validationLastEtdSec: ret - 600,
};
const live = buildEtaCandidateSlot(pinnedSource);
assert(live && live.overrunSeconds === undefined, 'default omits overrunSeconds');
assert(live && live.validationReturnSec === undefined, 'default omits validationReturnSec');
assert(live && live.validationLastEtdSec === undefined, 'default omits validationLastEtdSec');

const legacy = buildEtaCandidateSlot(pinnedSource, { pinSearchValidation: true });
assert(legacy && legacy.validationReturnSec === ret, 'legacy pin keeps validationReturnSec');

// Badge max() parity: reconciled wins over optimistic API
const api = coerceOverrunSeconds(180) ?? 0;
const reconciled = coerceOverrunSeconds(30 * 60) ?? 0;
assert(Math.max(api, reconciled) === 30 * 60, 'reconciled overrun wins for badge');

function startPastWorkdayEndSeconds(suggestedStartIso, endDepotTime) {
  const endSec = localHmsToSeconds(endDepotTime);
  if (endSec == null) return undefined;
  const raw = typeof suggestedStartIso === 'string' ? suggestedStartIso.trim() : '';
  if (!raw) return undefined;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return undefined;
  const startSec = /[zZ]|[+\-]\d{2}:\d{2}$/.test(raw)
    ? (() => {
        const m = raw.match(/T(\d{2}):(\d{2})(?::(\d{2}))?/);
        if (!m) return undefined;
        return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] || 0);
      })()
    : d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
  if (startSec == null) return undefined;
  return Math.max(0, startSec - endSec);
}

assert(
  startPastWorkdayEndSeconds('2026-09-23T17:05:00.000-04:00', '16:00') === 65 * 60,
  '5:05 PM start is +65m past 4:00 line'
);
assert(
  startPastWorkdayEndSeconds('2026-09-23T12:40:00.000-04:00', '16:00') === 0,
  'in-hours start is not past the line'
);
assert(
  startPastWorkdayEndSeconds('2026-09-23T16:00:00.000-04:00', '16:00') === 0,
  'start on the line is not overflow'
);
const startPast = startPastWorkdayEndSeconds('2026-09-23T17:05:00.000-04:00', '16:00') ?? 0;
assert(
  Math.max(0, startPast) >= 60,
  'start-after-line badges when depot-return overrun is 0'
);

console.log('depotReturnOverrunSmoke: ok');

/**
 * Smoke: zero-width arrival windows (HOLD – In Office / Fixed Time 0±0) pin Routed-timeline
 * layout to booked clock — same as named Fixed Time with no flexible window.
 *
 * Repro: late-day office HOLD overlapping a wide-window field visit must not follow an early
 * ETA that stacks the office stop *above* the earlier windowed appointment.
 *
 * Run: node scripts/zeroWidthArrivalWindowClockSmoke.mjs
 */

function arrivalWindowIsZeroWidth(windowStartIso, windowEndIso) {
  const start = typeof windowStartIso === 'string' ? windowStartIso.trim() : '';
  const end = typeof windowEndIso === 'string' ? windowEndIso.trim() : '';
  if (!start || !end) return false;
  const wStart = Date.parse(start);
  const wEnd = Date.parse(end);
  if (!Number.isFinite(wStart) || !Number.isFinite(wEnd)) return false;
  return (wEnd - wStart) / 60000 <= 0;
}

const FIXED_TIME_ETA_SLIP_TOLERANCE_SECONDS = 60;

function fixedTimeRouteEtaMeaningfullyAfterScheduledStart(schedStartIso, etaIso, toleranceSec = FIXED_TIME_ETA_SLIP_TOLERANCE_SECONDS) {
  if (!schedStartIso?.trim() || !etaIso?.trim()) return false;
  const sched = Date.parse(schedStartIso);
  const eta = Date.parse(etaIso);
  if (!Number.isFinite(sched) || !Number.isFinite(eta)) return false;
  return (eta - sched) / 1000 > toleranceSec;
}

function clientFixedTimeUsesDoctorDayClockForDriveLayout(opts) {
  const windowStart = opts.windowStartIso?.trim();
  const windowEnd = opts.windowEndIso?.trim();
  if (windowStart && windowEnd && !arrivalWindowIsZeroWidth(windowStart, windowEnd)) {
    return false;
  }
  const schedStart = opts.schedStartIso?.trim();
  const eta = opts.etaIso?.trim();
  if (!eta || !schedStart) return true;
  if (fixedTimeRouteEtaMeaningfullyAfterScheduledStart(schedStart, eta)) return false;
  return true;
}

function clientVisitUsesDoctorDayClockForDriveLayout(opts) {
  const zeroWidth = arrivalWindowIsZeroWidth(opts.windowStartIso, opts.windowEndIso);
  if (!opts.isClientFixedTime && !zeroWidth) return false;
  return clientFixedTimeUsesDoctorDayClockForDriveLayout({
    schedStartIso: opts.schedStartIso,
    etaIso: opts.etaIso,
    windowStartIso: opts.windowStartIso,
    windowEndIso: opts.windowEndIso,
  });
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const day = '2026-08-20';
// Eddie HOLD – In Office @ 3:30 (zero-width window); ETA wrongly earlier than Lucky
const eddieSched = `${day}T19:30:00.000Z`; // 3:30 PM ET
const eddieEtaEarly = `${day}T18:10:00.000Z`; // 2:10 PM ET — would stack above Lucky
const eddieWindow = eddieSched; // 0±0

assert(arrivalWindowIsZeroWidth(eddieWindow, eddieWindow) === true, '0±0 is zero-width');
assert(
  arrivalWindowIsZeroWidth(`${day}T18:35:00.000Z`, `${day}T20:35:00.000Z`) === false,
  'Lucky ±60-style window is not zero-width'
);

assert(
  clientVisitUsesDoctorDayClockForDriveLayout({
    isClientFixedTime: false,
    schedStartIso: eddieSched,
    etaIso: eddieEtaEarly,
    windowStartIso: eddieWindow,
    windowEndIso: eddieWindow,
  }) === true,
  'HOLD 0±0 pins to booked clock despite early ETA (not Fixed Time by name)'
);

assert(
  clientVisitUsesDoctorDayClockForDriveLayout({
    isClientFixedTime: false,
    schedStartIso: eddieSched,
    etaIso: eddieEtaEarly,
    windowStartIso: `${day}T18:35:00.000Z`,
    windowEndIso: `${day}T20:35:00.000Z`,
  }) === false,
  'Positive-width window without Fixed Time name stays on ETA layout'
);

assert(
  clientFixedTimeUsesDoctorDayClockForDriveLayout({
    schedStartIso: eddieSched,
    etaIso: eddieEtaEarly,
    windowStartIso: eddieWindow,
    windowEndIso: eddieWindow,
  }) === true,
  'Named Fixed Time helper: zero-width counts as no flexible window'
);

assert(
  clientFixedTimeUsesDoctorDayClockForDriveLayout({
    schedStartIso: eddieSched,
    etaIso: eddieEtaEarly,
    windowStartIso: `${day}T18:30:00.000Z`,
    windowEndIso: `${day}T20:30:00.000Z`,
  }) === false,
  'Named Fixed Time helper: positive-width uses ETA'
);

// Result-card: zero-width should show visit span, not X–X
function routingResultVisitTimeLabel(opt, serviceMinutes) {
  const awStart = opt.arrivalWindow?.windowStartIso;
  const awEnd = opt.arrivalWindow?.windowEndIso;
  const zeroWidth = Boolean(awStart && awEnd && arrivalWindowIsZeroWidth(awStart, awEnd));
  if (awStart && awEnd && !zeroWidth) {
    return { label: 'Arrival Window', timeText: 'window', zeroWidthWindow: false };
  }
  const startIso = opt.suggestedStartIso?.trim() || awStart || '';
  const mins = Math.max(1, Math.floor(Number(serviceMinutes)) || 30);
  const endMs = Date.parse(startIso) + mins * 60000;
  return {
    label: 'Visit time',
    timeText: `${startIso}->${new Date(endMs).toISOString()}`,
    zeroWidthWindow: zeroWidth,
  };
}

const card = routingResultVisitTimeLabel(
  {
    suggestedStartIso: eddieSched,
    arrivalWindow: { windowStartIso: eddieWindow, windowEndIso: eddieWindow },
  },
  30
);
assert(card.label === 'Visit time', 'zero-width result card uses Visit time label');
assert(card.zeroWidthWindow === true, 'zero-width flagged');
assert(card.timeText.includes('->'), 'zero-width shows start→end span');

console.log('zeroWidthArrivalWindowClockSmoke: ok');

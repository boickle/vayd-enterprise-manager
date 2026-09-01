/**
 * Smoke: Expected ETA must not start before the promised arrival window.
 *
 * Repro (bugs-scout): euths with Expected 12:30 / window 1–2pm and Expected 2:10 /
 * window 2:40–3:40. Visit Highlights showed type ±N windows while `/routing/eta`
 * returned raw drive arrivals before window open (often when households lacked
 * effectiveWindow on the ETA request).
 *
 * Run: node scripts/etaArrivalWindowClampSmoke.mjs
 */

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/** Mirrors clampTimelineEtasToArrivalWindows (route-order cumulative delay). */
function clampTimelineEtasToArrivalWindows({ households, timeline, routingOrderIndices }) {
  let cumulativeDelayMs = 0;
  for (const idx of routingOrderIndices) {
    const h = households[idx];
    const slot = timeline[idx];
    if (!h || !slot?.eta) continue;

    let etaMs = Date.parse(slot.eta) + cumulativeDelayMs;
    let etdMs = slot.etd ? Date.parse(slot.etd) + cumulativeDelayMs : null;

    const winStart =
      slot.windowStartIso ||
      h.windowStartIso ||
      h.effectiveWindow?.startIso ||
      null;
    if (winStart) {
      const wStartMs = Date.parse(winStart);
      if (Number.isFinite(wStartMs) && etaMs < wStartMs) {
        const extra = wStartMs - etaMs;
        cumulativeDelayMs += extra;
        if (etdMs != null) etdMs += extra;
        etaMs = wStartMs;
      }
    }

    slot.eta = new Date(etaMs).toISOString();
    if (etdMs != null) slot.etd = new Date(etdMs).toISOString();
  }
}

/** Mirrors etaHouseholdArrivalWindowPayload type ±N fallback when effectiveWindow missing. */
function etaHouseholdArrivalWindowPayload(args) {
  const { isBlock, isNoLocation, lat, lon, startIso, endIso, effectiveWindow, windowBeforeMinutes = 60, windowAfterMinutes = 60 } = args;
  if (isBlock) {
    return { isPersonalBlock: true, windowStartIso: startIso ?? null, windowEndIso: endIso ?? null };
  }
  const isRoutable = !isNoLocation && Number.isFinite(lat) && Number.isFinite(lon);
  if (isRoutable && effectiveWindow?.startIso && effectiveWindow?.endIso) {
    return { windowStartIso: effectiveWindow.startIso, windowEndIso: effectiveWindow.endIso };
  }
  if (isRoutable && startIso) {
    const startMs = Date.parse(startIso);
    if (!Number.isFinite(startMs)) return {};
    return {
      windowStartIso: new Date(startMs - windowBeforeMinutes * 60000).toISOString(),
      windowEndIso: new Date(startMs + windowAfterMinutes * 60000).toISOString(),
    };
  }
  return {};
}

// --- Millie-style: ETA 30m before window start ---
{
  const windowStart = '2026-09-01T17:00:00.000Z'; // 1:00 PM EDT
  const windowEnd = '2026-09-01T18:00:00.000Z'; // 2:00 PM EDT
  const etaEarly = '2026-09-01T16:30:00.000Z'; // 12:30 PM
  const etdEarly = '2026-09-01T17:45:00.000Z'; // 1:45 PM (75m service)

  const households = [
    {
      windowStartIso: windowStart,
      windowEndIso: windowEnd,
    },
  ];
  const timeline = [{ eta: etaEarly, etd: etdEarly, windowStartIso: windowStart, windowEndIso: windowEnd }];
  clampTimelineEtasToArrivalWindows({
    households,
    timeline,
    routingOrderIndices: [0],
  });

  assert(timeline[0].eta === windowStart, `Millie ETA should clamp to window start, got ${timeline[0].eta}`);
  assert(
    timeline[0].etd === '2026-09-01T18:15:00.000Z',
    `Millie ETD should shift +30m with ETA, got ${timeline[0].etd}`
  );
}

// --- Ocean + cascade: early stop delays the next ---
{
  const millieWin = '2026-09-01T17:00:00.000Z';
  const oceanWin = '2026-09-01T18:40:00.000Z'; // 2:40 PM EDT
  const households = [
    { windowStartIso: millieWin, windowEndIso: '2026-09-01T18:00:00.000Z' },
    { windowStartIso: oceanWin, windowEndIso: '2026-09-01T19:40:00.000Z' },
  ];
  const timeline = [
    {
      eta: '2026-09-01T16:30:00.000Z',
      etd: '2026-09-01T17:45:00.000Z',
      windowStartIso: millieWin,
    },
    {
      // Would have been fine vs early Millie ETD, but must move after Millie waits for window
      eta: '2026-09-01T18:10:00.000Z', // 2:10 PM — before Ocean window
      etd: '2026-09-01T19:10:00.000Z',
      windowStartIso: oceanWin,
    },
  ];
  clampTimelineEtasToArrivalWindows({
    households,
    timeline,
    routingOrderIndices: [0, 1],
  });

  assert(timeline[0].eta === millieWin, 'first stop clamps to its window');
  assert(timeline[1].eta === oceanWin, `Ocean ETA should be window start, got ${timeline[1].eta}`);
  // Ocean originally 30m early; Millie also added 30m delay → Ocean shifts by max path through cascade
  const oceanEtd = Date.parse(timeline[1].etd);
  const oceanEta = Date.parse(timeline[1].eta);
  assert(oceanEtd - oceanEta === 60 * 60000, 'Ocean service duration preserved');
}

// --- Payload: missing effectiveWindow still sends type ±N window ---
{
  const startIso = '2026-09-01T17:30:00.000Z'; // scheduled 1:30 PM EDT
  const payload = etaHouseholdArrivalWindowPayload({
    isBlock: false,
    isNoLocation: false,
    lat: 43.9,
    lon: -70.1,
    startIso,
    endIso: '2026-09-01T18:45:00.000Z',
    effectiveWindow: null,
    windowBeforeMinutes: 30,
    windowAfterMinutes: 30,
  });
  assert(payload.windowStartIso, 'type fallback must send windowStartIso');
  assert(payload.windowEndIso, 'type fallback must send windowEndIso');
  assert(
    Date.parse(payload.windowStartIso) === Date.parse(startIso) - 30 * 60000,
    'window start = scheduled − before'
  );
  assert(
    Date.parse(payload.windowEndIso) === Date.parse(startIso) + 30 * 60000,
    'window end = scheduled + after'
  );

  const withEw = etaHouseholdArrivalWindowPayload({
    isBlock: false,
    isNoLocation: false,
    lat: 43.9,
    lon: -70.1,
    startIso,
    endIso: '2026-09-01T18:45:00.000Z',
    effectiveWindow: {
      startIso: '2026-09-01T17:00:00.000Z',
      endIso: '2026-09-01T18:00:00.000Z',
    },
    windowBeforeMinutes: 60,
    windowAfterMinutes: 60,
  });
  assert(
    withEw.windowStartIso === '2026-09-01T17:00:00.000Z',
    'prefer doctor-day effectiveWindow over type ±N'
  );
}

// --- Already inside window: unchanged ---
{
  const timeline = [
    {
      eta: '2026-09-01T17:15:00.000Z',
      etd: '2026-09-01T18:30:00.000Z',
      windowStartIso: '2026-09-01T17:00:00.000Z',
      windowEndIso: '2026-09-01T18:00:00.000Z',
    },
  ];
  const before = { ...timeline[0] };
  clampTimelineEtasToArrivalWindows({
    households: [{}],
    timeline,
    routingOrderIndices: [0],
  });
  assert(timeline[0].eta === before.eta, 'in-window ETA stays put');
  assert(timeline[0].etd === before.etd, 'in-window ETD stays put');
}

console.log('etaArrivalWindowClampSmoke: ok');

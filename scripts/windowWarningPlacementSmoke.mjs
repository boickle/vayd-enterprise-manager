/**
 * Smoke: window warnings (Belle/Hews thread — #bugs-scout 1787344353.605449)
 *
 * 1) "Within 20 minutes of window end" is inclusive (ETA exactly 20m before end warns).
 * 2) View Placement must not attribute an *upstream* pre-existing tight visit to the new
 *    result card — only the candidate or stops at/after it in route order.
 *
 * Run: node scripts/windowWarningPlacementSmoke.mjs
 */

const WINDOW_WARNING_MINUTES_FROM_END = 20;

function shouldShowEtaWindowWarning(etaIso, windowEndIso, windowStartIso) {
  if (!etaIso?.trim?.() || !windowEndIso?.trim?.()) return false;
  const eta = Date.parse(etaIso);
  const wEnd = Date.parse(windowEndIso);
  if (!Number.isFinite(eta) || !Number.isFinite(wEnd)) return false;

  const windowStart = typeof windowStartIso === 'string' ? windowStartIso.trim() : '';
  if (windowStart) {
    const wStart = Date.parse(windowStart);
    if (Number.isFinite(wStart)) {
      const windowMinutes = (wEnd - wStart) / 60000;
      if (windowMinutes <= 0) {
        // Zero-width: only warn when ETA meaningfully after end (skip in this smoke).
        return (eta - wEnd) / 1000 > 60;
      }
    }
  }

  const minutesRemaining = (wEnd - eta) / 60000;
  return minutesRemaining <= WINDOW_WARNING_MINUTES_FROM_END;
}

function computeDriveTimeWindowWarning(opts) {
  const eta = opts.etaIso?.trim?.() ? opts.etaIso.trim() : '';
  if (!eta) return false;
  const windowEnd = opts.windowEndIso?.trim?.() ? opts.windowEndIso.trim() : '';
  if (windowEnd) {
    return shouldShowEtaWindowWarning(eta, windowEnd, opts.windowStartIso);
  }
  return false;
}

/** Mirrors src/utils/routingCardWindowWarning.ts summarizeReconciledDayWindowWarnings */
function summarizeReconciledDayWindowWarnings(dayData) {
  if (!dayData?.households?.length) {
    return {
      hasAnyWarning: false,
      warningStopCount: 0,
      candidateHasWarning: false,
      hasPlacementRelevantWarning: false,
    };
  }

  const households = dayData.households;
  const n = households.length;
  const order =
    Array.isArray(dayData.routingOrderIndices) && dayData.routingOrderIndices.length === n
      ? dayData.routingOrderIndices
      : Array.from({ length: n }, (_, i) => i);

  let previewOrderPos = -1;
  for (let p = 0; p < order.length; p++) {
    if (households[order[p]]?.isPreview) {
      previewOrderPos = p;
      break;
    }
  }

  let warningStopCount = 0;
  let candidateHasWarning = false;
  let hasPlacementRelevantWarning = false;

  for (let orderPos = 0; orderPos < order.length; orderPos++) {
    const idx = order[orderPos];
    const h = households[idx];
    if (!h || h.isPersonalBlock) continue;
    const slot = dayData.timeline[idx] ?? {};
    const warns = computeDriveTimeWindowWarning({
      etaIso: slot.eta ?? null,
      windowEndIso: h.effectiveWindow?.endIso ?? null,
      windowStartIso: h.effectiveWindow?.startIso ?? null,
      isClientFixedTime: false,
      scheduledStartIso: h.startIso,
    });
    if (warns) {
      warningStopCount += 1;
      if (h.isPreview) candidateHasWarning = true;
      if (previewOrderPos < 0 || orderPos >= previewOrderPos) {
        hasPlacementRelevantWarning = true;
      }
    }
  }

  return {
    hasAnyWarning: warningStopCount > 0,
    warningStopCount,
    candidateHasWarning,
    hasPlacementRelevantWarning,
  };
}

function routingCardWindowWarningReasons(opt, etaReconciled) {
  const reasons = [];
  const edge =
    opt?.scoreBreakdown?.downstreamWindowEdge ?? opt?.scoringComponents?.downstreamWindowEdge;
  if (typeof edge === 'number' && Number.isFinite(edge) && edge > 0) {
    reasons.push('downstream-score');
  }
  if (etaReconciled?.hasPlacementRelevantWarning) reasons.push('eta-reconciled');
  return reasons;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const day = '2026-08-26';
// Belle Bell: Expected arrival 12:15 PM ET, promised window end 12:35 PM ET (= exactly 20m)
const belleEta = `${day}T16:15:00.000Z`; // 12:15 PM EDT
const belleWindowStart = `${day}T14:35:00.000Z`; // 10:35 AM
const belleWindowEnd = `${day}T16:35:00.000Z`; // 12:35 PM

assert(
  shouldShowEtaWindowWarning(belleEta, belleWindowEnd, belleWindowStart) === true,
  'exactly 20 minutes remaining must warn (within 20 inclusive)'
);
assert(
  shouldShowEtaWindowWarning(`${day}T16:16:00.000Z`, belleWindowEnd, belleWindowStart) === true,
  '19 minutes remaining must warn'
);
assert(
  shouldShowEtaWindowWarning(`${day}T16:14:00.000Z`, belleWindowEnd, belleWindowStart) === false,
  '21 minutes remaining must not warn'
);
assert(
  shouldShowEtaWindowWarning(`${day}T16:40:00.000Z`, belleWindowEnd, belleWindowStart) === true,
  'past window end must warn'
);

// Jaimoe Hews preview after Belle — Belle already tight; candidate is fine
const jaimoeStart = `${day}T19:00:00.000Z`; // 3:00 PM
const jaimoeWindowStart = `${day}T18:00:00.000Z`; // 2:00 PM
const jaimoeWindowEnd = `${day}T20:00:00.000Z`; // 4:00 PM

const dayWithUpstreamWarning = {
  households: [
    {
      isPreview: false,
      isPersonalBlock: false,
      startIso: `${day}T15:35:00.000Z`,
      effectiveWindow: { startIso: belleWindowStart, endIso: belleWindowEnd },
    },
    {
      isPreview: true,
      isPersonalBlock: false,
      startIso: jaimoeStart,
      effectiveWindow: { startIso: jaimoeWindowStart, endIso: jaimoeWindowEnd },
    },
  ],
  timeline: [{ eta: belleEta }, { eta: jaimoeStart }],
  routingOrderIndices: [0, 1],
};

const upstreamOnly = summarizeReconciledDayWindowWarnings(dayWithUpstreamWarning);
assert(upstreamOnly.hasAnyWarning === true, 'Belle tightness still counted in hasAnyWarning');
assert(upstreamOnly.candidateHasWarning === false, 'Jaimoe candidate itself is not tight');
assert(
  upstreamOnly.hasPlacementRelevantWarning === false,
  'upstream-only must NOT be placement-relevant'
);
assert(
  routingCardWindowWarningReasons({}, upstreamOnly).length === 0,
  'routing card must stay quiet when only an earlier visit is tight'
);

// Candidate itself tight
const dayCandidateTight = {
  households: [
    {
      isPreview: false,
      isPersonalBlock: false,
      startIso: `${day}T14:00:00.000Z`,
      effectiveWindow: {
        startIso: `${day}T13:00:00.000Z`,
        endIso: `${day}T15:00:00.000Z`,
      },
    },
    {
      isPreview: true,
      isPersonalBlock: false,
      startIso: jaimoeStart,
      effectiveWindow: { startIso: jaimoeWindowStart, endIso: jaimoeWindowEnd },
    },
  ],
  timeline: [
    { eta: `${day}T14:00:00.000Z` }, // 60m before end — fine
    { eta: `${day}T19:45:00.000Z` }, // 15m before 4:00 end — tight
  ],
  routingOrderIndices: [0, 1],
};
const cand = summarizeReconciledDayWindowWarnings(dayCandidateTight);
assert(cand.candidateHasWarning === true, 'tight preview sets candidateHasWarning');
assert(cand.hasPlacementRelevantWarning === true, 'candidate tightness is placement-relevant');
assert(
  routingCardWindowWarningReasons({}, cand).includes('eta-reconciled'),
  'routing card shows eta-reconciled when candidate is tight'
);

// Downstream (after preview) tight, candidate fine
const dayDownstreamTight = {
  households: [
    {
      isPreview: true,
      isPersonalBlock: false,
      startIso: `${day}T15:00:00.000Z`,
      effectiveWindow: {
        startIso: `${day}T14:00:00.000Z`,
        endIso: `${day}T16:00:00.000Z`,
      },
    },
    {
      isPreview: false,
      isPersonalBlock: false,
      startIso: `${day}T17:00:00.000Z`,
      effectiveWindow: {
        startIso: `${day}T16:00:00.000Z`,
        endIso: `${day}T18:00:00.000Z`,
      },
    },
  ],
  timeline: [
    { eta: `${day}T15:00:00.000Z` }, // fine
    { eta: `${day}T17:50:00.000Z` }, // 10m before end — tight downstream
  ],
  routingOrderIndices: [0, 1],
};
const down = summarizeReconciledDayWindowWarnings(dayDownstreamTight);
assert(down.candidateHasWarning === false, 'preview itself fine');
assert(down.hasPlacementRelevantWarning === true, 'downstream tightness is placement-relevant');
assert(
  routingCardWindowWarningReasons({}, down).includes('eta-reconciled'),
  'routing card warns when a later stop is pushed near window end'
);

console.log('windowWarningPlacementSmoke: ok');

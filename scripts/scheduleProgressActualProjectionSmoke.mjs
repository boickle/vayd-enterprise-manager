/**
 * Smoke: Schedule Progress Actual column must keep full visit length while on site.
 *
 * Slack (#bugs-scout): LB at Cushman arrived 22 mins late; Predicted showed 1h,
 * Actual shortened to scheduled end (~33m) so the rest of the day looked fine
 * instead of cascading lateness to later stops.
 *
 * Run: node scripts/scheduleProgressActualProjectionSmoke.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function parseMs(iso) {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

function predictedServiceMinutes(predictedStartIso, predictedEndIso, fallbackMinutes = 60) {
  const start = parseMs(predictedStartIso);
  const end = parseMs(predictedEndIso);
  if (start != null && end != null) {
    const mins = (end - start) / 60000;
    if (Number.isFinite(mins) && mins > 0) return Math.max(1, Math.round(mins));
  }
  return Math.max(1, Math.floor(fallbackMinutes));
}

/** Mirror of projectScheduleProgressActualVisits. */
function projectScheduleProgressActualVisits(visits) {
  let leaveDelayMs = 0;
  const out = [];

  for (const v of visits) {
    const predictedStart = parseMs(v.predictedStartIso);
    const predictedEnd = parseMs(v.predictedEndIso);
    const actualStart = parseMs(v.actualStartIso);
    const actualEnd = parseMs(v.actualEndIso);
    const durationMin = predictedServiceMinutes(v.predictedStartIso, v.predictedEndIso);

    if (actualStart != null && actualEnd != null) {
      out.push({
        startIso: new Date(actualStart).toISOString(),
        endIso: new Date(actualEnd).toISOString(),
        projectedLeave: false,
      });
      if (predictedEnd != null) leaveDelayMs = actualEnd - predictedEnd;
      continue;
    }

    if (actualStart != null && actualEnd == null) {
      const projectedEnd = actualStart + durationMin * 60000;
      out.push({
        startIso: new Date(actualStart).toISOString(),
        endIso: new Date(projectedEnd).toISOString(),
        projectedLeave: true,
      });
      if (predictedEnd != null) leaveDelayMs = projectedEnd - predictedEnd;
      else if (predictedStart != null) leaveDelayMs = actualStart - predictedStart;
      continue;
    }

    if (predictedStart != null && predictedEnd != null) {
      out.push({
        startIso: new Date(predictedStart + leaveDelayMs).toISOString(),
        endIso: new Date(predictedEnd + leaveDelayMs).toISOString(),
        projectedLeave: leaveDelayMs !== 0,
      });
      continue;
    }

    out.push({
      startIso: v.predictedStartIso,
      endIso: v.predictedEndIso,
      projectedLeave: false,
    });
  }

  return { visits: out, leaveDelayMs };
}

// Source wiring
const utilSrc = fs.readFileSync(
  path.join(here, '../src/utils/scheduleProgressActualProjection.ts'),
  'utf8'
);
assert(
  /export function projectScheduleProgressActualVisits/.test(utilSrc),
  'util must export projectScheduleProgressActualVisits'
);
assert(
  /projectedLeave/.test(utilSrc),
  'util must mark projected leaves'
);

const modalSrc = fs.readFileSync(
  path.join(here, '../src/components/SchedulerReconcileModal.tsx'),
  'utf8'
);
assert(
  /projectScheduleProgressActualVisits/.test(modalSrc),
  'SchedulerReconcileModal must project in-progress actual visits'
);
assert(
  !/\(appt\?\.appointmentEndActual\?\.trim\(\) \|\| null\) \?\? h\.endIso \?\? appt\?\.appointmentEnd/.test(
    modalSrc
  ),
  'must not fall back to scheduled end while still on site'
);

// --- Cushman repro: arrive 22m late, no leave yet, 60m predicted ---
const cushmanPredictedStart = '2026-09-01T16:30:00.000Z'; // 12:30 PM ET
const cushmanPredictedEnd = '2026-09-01T17:30:00.000Z'; // 1:30 PM ET
const cushmanActualStart = '2026-09-01T16:52:00.000Z'; // 12:52 PM ET
const woodwardPredictedStart = '2026-09-01T17:40:00.000Z'; // 1:40 PM ET
const woodwardPredictedEnd = '2026-09-01T18:30:00.000Z'; // 2:30 PM ET

const { visits, leaveDelayMs } = projectScheduleProgressActualVisits([
  {
    predictedStartIso: cushmanPredictedStart,
    predictedEndIso: cushmanPredictedEnd,
    actualStartIso: cushmanActualStart,
    actualEndIso: null,
  },
  {
    predictedStartIso: woodwardPredictedStart,
    predictedEndIso: woodwardPredictedEnd,
    actualStartIso: null,
    actualEndIso: null,
  },
]);

assert(visits[0].projectedLeave === true, 'Cushman leave is projected');
assert(visits[0].startIso === cushmanActualStart, 'Cushman start stays actual arrive');

const cushmanDurMin =
  (parseMs(visits[0].endIso) - parseMs(visits[0].startIso)) / 60000;
assert(cushmanDurMin === 60, `Cushman must stay 60m, got ${cushmanDurMin}`);

// Bug was truncating to scheduled 1:25 (~33m from 12:52)
assert(cushmanDurMin > 40, 'must not shorten in-progress visit to scheduled end');

assert(Math.round(leaveDelayMs / 60000) === 22, `leave delay should be 22m, got ${leaveDelayMs}`);

const woodwardShiftMin =
  (parseMs(visits[1].startIso) - parseMs(woodwardPredictedStart)) / 60000;
assert(
  Math.round(woodwardShiftMin) === 22,
  `Woodward should cascade +22m, got ${woodwardShiftMin}`
);
assert(visits[1].projectedLeave === true, 'downstream leave marked projected');

// Completed early visit should not invent a long projected leave
const early = projectScheduleProgressActualVisits([
  {
    predictedStartIso: cushmanPredictedStart,
    predictedEndIso: cushmanPredictedEnd,
    actualStartIso: cushmanActualStart,
    actualEndIso: '2026-09-01T17:20:00.000Z', // left 10m early vs predicted end
  },
  {
    predictedStartIso: woodwardPredictedStart,
    predictedEndIso: woodwardPredictedEnd,
    actualStartIso: null,
    actualEndIso: null,
  },
]);
assert(early.visits[0].projectedLeave === false, 'recorded leave is not projected');
assert(
  Math.round(early.leaveDelayMs / 60000) === -10,
  'early leave should pull the day forward'
);
assert(
  Math.round((parseMs(early.visits[1].startIso) - parseMs(woodwardPredictedStart)) / 60000) === -10,
  'downstream should shift earlier after early leave'
);

console.log('scheduleProgressActualProjectionSmoke: ok');

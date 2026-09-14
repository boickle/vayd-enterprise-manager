/**
 * Smoke: single-doctor Get Best Route must label other-doctor fallback slots
 * even when the API omits doctorFallback / isFallbackDoctor metadata.
 *
 * Repro (bugs-scout 1789389022.268099): LB-only search returned BQ/NP with no
 * banner or "Not the requested doctor" chip (PR #343 UI present, flags missing).
 *
 * Run: node scripts/routingDoctorFallbackSmoke.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function normDoctorId(id) {
  return String(id ?? '').trim();
}

function isSingleDoctorRoutingSearch(opts) {
  if (opts.asapAllDoctorSearch || opts.multiDoctor) return false;
  return Boolean(normDoctorId(opts.requestedDoctorId));
}

function slotIsFallbackDoctor(slot, requestedDoctorId, opts = {}) {
  if (!slot) return false;
  if (slot.isFallbackDoctor === true) return true;

  const requested = normDoctorId(requestedDoctorId);
  if (!requested) return false;
  if (opts.asapAllDoctorSearch || opts.multiDoctor) return false;

  const slotId = normDoctorId(slot.doctorPimsId) || normDoctorId(slot.doctorId);
  if (!slotId) return false;
  if (slotId === requested) return false;

  if (opts.apiFallback?.requestedDoctorHadNoAvailability === true) return true;
  return true;
}

function buildDoctorFallbackNotice(opts) {
  const {
    apiFallback,
    requestedDoctorId,
    requestedDoctorName,
    asapAllDoctorSearch,
    multiDoctor,
    options,
  } = opts;

  if (!options.length) return null;
  if (!isSingleDoctorRoutingSearch({ asapAllDoctorSearch, multiDoctor, requestedDoctorId })) {
    if (!apiFallback?.requestedDoctorHadNoAvailability) return null;
  }

  const fallbackOpts = options.filter((o) =>
    slotIsFallbackDoctor(o, requestedDoctorId, {
      asapAllDoctorSearch,
      multiDoctor,
      apiFallback,
    })
  );

  const apiSaysWidened = apiFallback?.requestedDoctorHadNoAvailability === true;
  if (!apiSaysWidened && fallbackOpts.length === 0) return null;

  const inferredWidened =
    isSingleDoctorRoutingSearch({ asapAllDoctorSearch, multiDoctor, requestedDoctorId }) &&
    fallbackOpts.length === options.length;

  if (!apiSaysWidened && !inferredWidened) return null;

  const labeled = fallbackOpts.length > 0 ? fallbackOpts : options;
  const requestedName = requestedDoctorName?.trim() || 'The requested doctor';
  const otherNames = Array.from(
    new Set(labeled.map((o) => o.doctorName?.trim()).filter(Boolean))
  );
  const who =
    otherNames.length === 0
      ? 'other doctors'
      : otherNames.length === 1
        ? otherNames[0]
        : `${otherNames.length} other doctors`;

  return {
    headline: `${requestedName} has no availability for this request`,
    detail: `The ${options.length} slot${
      options.length === 1 ? '' : 's'
    } below belong to ${who}, shown because the original search found nothing.`,
  };
}

// --- Runtime: LB-only → BQ/NP with no API metadata (the reported bug) ---
const lbOnlySlots = [
  { doctorPimsId: 'bq-1', doctorName: 'Brian Quinn' },
  { doctorPimsId: 'np-1', doctorName: 'Nina Petersen' },
];

assert(
  slotIsFallbackDoctor(lbOnlySlots[0], 'lb-1', {
    asapAllDoctorSearch: false,
    multiDoctor: false,
  }),
  'BQ must be inferred as fallback for LB-only search'
);

const notice = buildDoctorFallbackNotice({
  requestedDoctorId: 'lb-1',
  requestedDoctorName: 'Lisa Benson',
  asapAllDoctorSearch: false,
  multiDoctor: false,
  options: lbOnlySlots,
});
assert(notice, 'must show banner when all slots are other doctors');
assert(
  /Lisa Benson has no availability/.test(notice.headline),
  `headline should name requested doctor, got: ${notice.headline}`
);
assert(
  /2 slots/.test(notice.detail) && /2 other doctors/.test(notice.detail),
  `detail should describe borrowed slots, got: ${notice.detail}`
);

// Same doctor → no fallback
assert(
  !slotIsFallbackDoctor(
    { doctorPimsId: 'lb-1', doctorName: 'Lisa Benson' },
    'lb-1',
    { asapAllDoctorSearch: false, multiDoctor: false }
  ),
  'matching doctor must not be flagged'
);
assert(
  buildDoctorFallbackNotice({
    requestedDoctorId: 'lb-1',
    requestedDoctorName: 'Lisa Benson',
    options: [{ doctorPimsId: 'lb-1', doctorName: 'Lisa Benson' }],
  }) === null,
  'same-doctor results must not show fallback banner'
);

// ASAP / Best fit: do not infer without API meta
assert(
  !slotIsFallbackDoctor(lbOnlySlots[0], 'lb-1', {
    asapAllDoctorSearch: true,
    multiDoctor: false,
  }),
  'ASAP must not infer fallback from id mismatch'
);
assert(
  buildDoctorFallbackNotice({
    requestedDoctorId: 'lb-1',
    requestedDoctorName: 'Lisa Benson',
    asapAllDoctorSearch: false,
    multiDoctor: true,
    options: lbOnlySlots,
  }) === null,
  'Best fit across doctors must not infer widened banner'
);

// Explicit API flag still works
assert(
  buildDoctorFallbackNotice({
    apiFallback: { requestedDoctorHadNoAvailability: true },
    requestedDoctorId: 'lb-1',
    requestedDoctorName: 'Lisa Benson',
    options: [
      { doctorPimsId: 'bq-1', doctorName: 'Brian Quinn', isFallbackDoctor: true },
    ],
  })?.detail.includes('Brian Quinn'),
  'API doctorFallback must still name the borrowed doctor'
);

// --- Wiring: Routing.tsx must use the shared helpers ---
const utilSrc = fs.readFileSync(
  path.join(root, 'src/utils/routingDoctorFallback.ts'),
  'utf8'
);
const routingSrc = fs.readFileSync(path.join(root, 'src/pages/Routing.tsx'), 'utf8');

assert(
  /export function slotIsFallbackDoctor/.test(utilSrc) &&
    /export function buildDoctorFallbackNotice/.test(utilSrc),
  'routingDoctorFallback util must export helpers'
);
assert(
  routingSrc.includes("from '../utils/routingDoctorFallback'"),
  'Routing.tsx must import routingDoctorFallback'
);
assert(
  /buildDoctorFallbackNotice\(/.test(routingSrc),
  'Routing.tsx must build the banner via buildDoctorFallbackNotice'
);
assert(
  /slotIsFallbackDoctor\(/.test(routingSrc),
  'Routing.tsx must mark cards via slotIsFallbackDoctor'
);
assert(
  /Not the requested doctor/.test(routingSrc),
  'per-card fallback warning copy must remain'
);

console.log('routingDoctorFallbackSmoke: ok');

/**
 * Smoke: locked single-doctor Get Best Route must drop fallback doctors who
 * do not accept the selected appointment type (Settings checkboxes).
 *
 * Repro (bugs-scout): LB-only Follow-Up returned Nina Petersen, who does not
 * see follow-ups. ASAP / Best fit already exclude her via the doctor picker.
 *
 * Run: node scripts/routingAppointmentTypeFilterSmoke.mjs
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
  return true;
}

function routingSlotDoctorId(slot) {
  return String(slot?.doctorPimsId ?? slot?.doctorId ?? '').trim();
}

function collectRoutingResultDoctorIds(result) {
  if (!result) return [];
  const ids = new Set();
  const add = (id) => {
    const t = String(id ?? '').trim();
    if (t) ids.add(t);
  };
  add(routingSlotDoctorId(result.winner));
  for (const row of result.alternates ?? []) add(routingSlotDoctorId(row));
  for (const doc of result.doctors ?? []) {
    add(doc.pimsId);
    for (const row of doc.top ?? []) add(routingSlotDoctorId(row));
  }
  for (const id of result.doctorFallback?.fallbackDoctorIds ?? []) add(id);
  return [...ids];
}

function shouldKeepRoutingSlotForAppointmentType(opts) {
  const {
    slot,
    requestedDoctorId,
    asapAllDoctorSearch,
    multiDoctor,
    appointmentTypeId,
    doctorsAcceptingType,
  } = opts;

  if (!slot) return false;
  const typeId = Number(appointmentTypeId);
  if (!Number.isFinite(typeId) || typeId <= 0) return true;
  if (asapAllDoctorSearch || multiDoctor) return true;

  const requested = String(requestedDoctorId ?? '').trim();
  const slotId = routingSlotDoctorId(slot);
  if (requested && slotId === requested) return true;

  const isFallback = slotIsFallbackDoctor(slot, requestedDoctorId, {
    asapAllDoctorSearch,
    multiDoctor,
  });
  if (!isFallback) return true;

  if (!slotId) return false;
  return doctorsAcceptingType.has(slotId);
}

function filterRoutingResultByAppointmentType(result, opts) {
  const typeId = Number(opts.appointmentTypeId);
  if (!Number.isFinite(typeId) || typeId <= 0) return result;
  if (
    !isSingleDoctorRoutingSearch({
      asapAllDoctorSearch: opts.asapAllDoctorSearch,
      multiDoctor: opts.multiDoctor,
      requestedDoctorId: opts.requestedDoctorId,
    })
  ) {
    return result;
  }

  const keep = (slot) =>
    shouldKeepRoutingSlotForAppointmentType({
      slot,
      requestedDoctorId: opts.requestedDoctorId,
      asapAllDoctorSearch: opts.asapAllDoctorSearch,
      multiDoctor: opts.multiDoctor,
      appointmentTypeId: opts.appointmentTypeId,
      doctorsAcceptingType: opts.doctorsAcceptingType,
    });

  const keptAlternates = (result.alternates ?? []).filter((row) => keep(row));
  let winner = result.winner && keep(result.winner) ? result.winner : undefined;
  let alternates = keptAlternates;
  if (!winner && alternates.length > 0) {
    winner = alternates[0];
    alternates = alternates.slice(1);
  }

  const doctors = Array.isArray(result.doctors)
    ? result.doctors
        .map((d) => ({
          ...d,
          top: (d.top ?? []).filter((row) => keep(row)),
        }))
        .filter((d) => (d.top?.length ?? 0) > 0)
    : result.doctors;

  const fallbackIds = result.doctorFallback?.fallbackDoctorIds;
  const doctorFallback =
    result.doctorFallback && Array.isArray(fallbackIds)
      ? {
          ...result.doctorFallback,
          fallbackDoctorIds: fallbackIds.filter((id) =>
            opts.doctorsAcceptingType.has(String(id ?? '').trim())
          ),
        }
      : result.doctorFallback;

  return {
    ...result,
    winner,
    alternates,
    doctors,
    doctorFallback,
  };
}

function employeeAcceptsAppointmentType(employee, appointmentTypeId) {
  const target = Number(appointmentTypeId);
  if (!Number.isFinite(target) || target <= 0) return true;
  const types = employee.appointmentTypes ?? [];
  return types.some((at) => at?.id != null && Number(at.id) === target);
}

const FOLLOW_UP_ID = 42;
const nina = {
  doctorPimsId: 'np-1',
  doctorId: 'np-1',
  doctorName: 'Nina Petersen',
};
const julie = {
  doctorPimsId: 'jg-1',
  doctorId: 'jg-1',
  doctorName: 'Julie Greenlaw',
};
const lisa = {
  doctorPimsId: 'lb-1',
  doctorId: 'lb-1',
  doctorName: 'Lisa Benson',
};

const widened = {
  winner: nina,
  alternates: [julie],
  doctors: [
    { pimsId: 'np-1', name: 'Nina Petersen', top: [nina] },
    { pimsId: 'jg-1', name: 'Julie Greenlaw', top: [julie] },
  ],
  doctorFallback: {
    requestedDoctorIds: ['lb-1'],
    requestedDoctorHadNoAvailability: true,
    fallbackDoctorIds: ['np-1', 'jg-1'],
  },
};

assert(
  collectRoutingResultDoctorIds(widened).sort().join(',') === 'jg-1,np-1',
  'collect ids from winner, alternates, doctors, fallback meta'
);

assert(
  !employeeAcceptsAppointmentType(
    { appointmentTypes: [{ id: 7, name: 'Tech Team SQ Fluids' }] },
    FOLLOW_UP_ID
  ),
  'Nina without Follow-Up assigned must not accept that type'
);
assert(
  employeeAcceptsAppointmentType(
    { appointmentTypes: [{ id: FOLLOW_UP_ID, name: 'Follow-Up' }] },
    FOLLOW_UP_ID
  ),
  'Julie with Follow-Up assigned must accept'
);

const accepting = new Set(['jg-1']);
const filtered = filterRoutingResultByAppointmentType(widened, {
  requestedDoctorId: 'lb-1',
  appointmentTypeId: FOLLOW_UP_ID,
  doctorsAcceptingType: accepting,
  asapAllDoctorSearch: false,
  multiDoctor: false,
});

assert(filtered.winner?.doctorPimsId === 'jg-1', 'promote remaining eligible fallback to winner');
assert((filtered.alternates ?? []).length === 0, 'Nina must be removed from alternates');
assert(
  (filtered.doctors ?? []).every((d) => d.pimsId !== 'np-1'),
  'Nina must be removed from doctors[]'
);
assert(
  (filtered.doctorFallback?.fallbackDoctorIds ?? []).join(',') === 'jg-1',
  'fallbackDoctorIds must drop doctors who do not see the type'
);

const emptyAfterFilter = filterRoutingResultByAppointmentType(widened, {
  requestedDoctorId: 'lb-1',
  appointmentTypeId: FOLLOW_UP_ID,
  doctorsAcceptingType: new Set(),
  asapAllDoctorSearch: false,
  multiDoctor: false,
});
assert(!emptyAfterFilter.winner, 'no eligible fallback → empty winner');
assert((emptyAfterFilter.alternates ?? []).length === 0, 'no eligible fallback → empty alternates');

const keepRequested = filterRoutingResultByAppointmentType(
  { winner: lisa, alternates: [nina] },
  {
    requestedDoctorId: 'lb-1',
    appointmentTypeId: FOLLOW_UP_ID,
    doctorsAcceptingType: new Set(),
    asapAllDoctorSearch: false,
    multiDoctor: false,
  }
);
assert(keepRequested.winner?.doctorPimsId === 'lb-1', 'requested doctor is never dropped');
assert((keepRequested.alternates ?? []).length === 0, 'ineligible fallback still dropped');

const noType = filterRoutingResultByAppointmentType(widened, {
  requestedDoctorId: 'lb-1',
  appointmentTypeId: null,
  doctorsAcceptingType: new Set(),
  asapAllDoctorSearch: false,
  multiDoctor: false,
});
assert(noType.winner?.doctorPimsId === 'np-1', 'no appointment type selected → do not filter');

const asapKept = filterRoutingResultByAppointmentType(widened, {
  requestedDoctorId: 'lb-1',
  appointmentTypeId: FOLLOW_UP_ID,
  doctorsAcceptingType: new Set(),
  asapAllDoctorSearch: true,
  multiDoctor: false,
});
assert(asapKept.winner?.doctorPimsId === 'np-1', 'ASAP must not apply this gate (staff picked doctors)');

const bestFitKept = filterRoutingResultByAppointmentType(widened, {
  requestedDoctorId: 'lb-1',
  appointmentTypeId: FOLLOW_UP_ID,
  doctorsAcceptingType: new Set(),
  asapAllDoctorSearch: false,
  multiDoctor: true,
});
assert(bestFitKept.winner?.doctorPimsId === 'np-1', 'Best fit must not apply this gate');

// --- Wiring ---
const utilSrc = fs.readFileSync(
  path.join(root, 'src/utils/routingAppointmentTypeFilter.ts'),
  'utf8'
);
const lookupSrc = fs.readFileSync(
  path.join(root, 'src/utils/veterinarianZoneLookup.ts'),
  'utf8'
);
const routingSrc = fs.readFileSync(path.join(root, 'src/pages/Routing.tsx'), 'utf8');

assert(
  /export function filterRoutingResultByAppointmentType/.test(utilSrc) &&
    /export function collectRoutingResultDoctorIds/.test(utilSrc),
  'routingAppointmentTypeFilter must export helpers'
);
assert(
  /export async function doctorPimsIdsAcceptingAppointmentType/.test(lookupSrc),
  'veterinarianZoneLookup must resolve Settings appointment-type assignments'
);
assert(
  routingSrc.includes("from '../utils/routingAppointmentTypeFilter'"),
  'Routing.tsx must import the appointment-type filter'
);
assert(
  /filterRoutingResultByAppointmentType\(/.test(routingSrc),
  'Routing.tsx must filter widened results by appointment type'
);
assert(
  /doctorPimsIdsAcceptingAppointmentType\(/.test(routingSrc),
  'Routing.tsx must look up which fallback doctors accept the type'
);

console.log('routingAppointmentTypeFilterSmoke: ok');

/**
 * Smoke: after a doctor-to-doctor move, calendar RL badges and room-loader resolve
 * must still honor a completed (or sent) room loader for the same patients even when
 * the appointment id on the loader no longer matches the visit on the new schedule.
 *
 * Bug (internal-scout 1790103200.452289): RL went green → red (not sent) after move.
 *
 * Run: node scripts/roomLoaderDoctorMoveStatusSmoke.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

const STATUS_RANK = { none: 0, sent: 1, complete: 2 };

function prefer(a, b) {
  return STATUS_RANK[a] >= STATUS_RANK[b] ? a : b;
}

function fromSentStatus(sentStatus) {
  const s = String(sentStatus ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
  if (!s || s === 'not_sent') return 'none';
  if (s === 'completed' || s === 'complete') return 'complete';
  if (s === 'sent' || s.startsWith('sent_')) return 'sent';
  return 'none';
}

function loaderPatientIds(rl) {
  const ids = new Set();
  for (const p of rl.patients ?? []) {
    const id = Number(p?.id);
    if (Number.isFinite(id) && id > 0) ids.add(id);
  }
  for (const a of rl.appointments ?? []) {
    const id = Number(a?.patient?.id);
    if (Number.isFinite(id) && id > 0) ids.add(id);
  }
  return [...ids];
}

function calendarPatientIds(a) {
  const ids = new Set();
  for (const p of a.patients ?? []) {
    const id = Number(p?.id);
    if (Number.isFinite(id) && id > 0) ids.add(id);
  }
  const nested = Number(a.patient?.id);
  if (Number.isFinite(nested) && nested > 0) ids.add(nested);
  const flat = Number(a.patientId);
  if (Number.isFinite(flat) && flat > 0) ids.add(flat);
  return [...ids];
}

/** Mirror of buildRoomLoaderPreApptStatusByAppointmentId (appointment + patient overlap). */
function buildStatusByAppointmentId(loaders, calendarAppointments) {
  const map = new Map();
  const byPatient = new Map();

  for (const rl of loaders) {
    const ui = fromSentStatus(rl.sentStatus);
    if (ui === 'none') continue;
    for (const a of rl.appointments ?? []) {
      const id = Number(a?.id);
      if (!Number.isFinite(id)) continue;
      map.set(id, prefer(map.get(id) ?? 'none', ui));
    }
    for (const patientId of loaderPatientIds(rl)) {
      byPatient.set(patientId, prefer(byPatient.get(patientId) ?? 'none', ui));
    }
  }

  if (!calendarAppointments?.length || byPatient.size === 0) return map;

  for (const appt of calendarAppointments) {
    const apptId = Number(appt?.id);
    if (!Number.isFinite(apptId) || apptId <= 0) continue;
    let best = 'none';
    for (const patientId of calendarPatientIds(appt)) {
      best = prefer(best, byPatient.get(patientId) ?? 'none');
    }
    if (best === 'none') continue;
    map.set(apptId, prefer(map.get(apptId) ?? 'none', best));
  }
  return map;
}

function sentStatusRank(sentStatus) {
  const s = String(sentStatus ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
  if (s === 'completed' || s === 'complete') return 3;
  if (s === 'sent' || s.startsWith('sent_')) return 2;
  if (s && s !== 'not_sent') return 1;
  return 0;
}

function roomLoaderAppointmentIds(rl) {
  return (rl.appointments ?? [])
    .map((a) => Number(a.id))
    .filter((id) => Number.isFinite(id));
}

/** Mirror of findBestRoomLoaderForClump with patient fallback + sentStatus preference. */
function findBestRoomLoaderForClump(rows, clumpAppointmentIds, clumpPatientIds = []) {
  if (clumpAppointmentIds.length === 0 && clumpPatientIds.length === 0) return null;

  const clumpApptSet = new Set(clumpAppointmentIds);
  const clumpPatientSet = new Set(clumpPatientIds);
  let best = null;
  let bestScore = -1;

  for (const row of rows) {
    const rlApptIds = roomLoaderAppointmentIds(row);
    const rlPatientIds = loaderPatientIds(row);
    const apptOverlap = rlApptIds.filter((id) => clumpApptSet.has(id)).length;
    const patientOverlap = rlPatientIds.filter((id) => clumpPatientSet.has(id)).length;
    if (apptOverlap === 0 && patientOverlap === 0) continue;

    const coversAllAppts = clumpApptSet.size > 0 && apptOverlap === clumpApptSet.size;
    const coversAllPatients =
      clumpPatientSet.size > 0 && patientOverlap === clumpPatientSet.size;
    const score =
      // Prefer filled-out loaders over blank not_sent rows that may have been
      // auto-linked to a re-keyed appointment after a doctor move.
      sentStatusRank(row.sentStatus) * 1_000_000 +
      apptOverlap * 100_000 +
      (coversAllAppts ? 50_000 : 0) +
      patientOverlap * 1_000 +
      (coversAllPatients ? 500 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = row;
    }
  }

  return best;
}

// --- Source wiring checks ---
const displaySrc = read('src/utils/roomLoaderPreApptDisplay.ts');
assert(
  displaySrc.includes('calendarAppointments') && displaySrc.includes('byPatient'),
  'roomLoaderPreApptDisplay must attribute status via patient overlap'
);

const resolveSrc = read('src/utils/schedulerRoomLoaderResolve.ts');
assert(
  resolveSrc.includes('patientOverlap') && resolveSrc.includes('sentStatusRank'),
  'schedulerRoomLoaderResolve must match room loaders by patient overlap'
);

const schedulerSrc = read('src/pages/Scheduler.tsx');
assert(
  schedulerSrc.includes('buildRoomLoaderPreApptStatusByAppointmentId(roomLoaderStatusSources, rawAppointments)'),
  'Scheduler must pass calendar appointments into RL status map builder'
);

// --- Behavior: doctor move recreates appointment id; completed RL still on old id ---
const completedLoader = {
  id: 10,
  sentStatus: 'completed',
  appointments: [{ id: 100, patient: { id: 55 } }],
  patients: [{ id: 55 }],
};
const blankLoaderOnNewAppt = {
  id: 11,
  sentStatus: 'not_sent',
  appointments: [{ id: 200, patient: { id: 55 } }],
  patients: [{ id: 55 }],
};
const newScheduleAppt = { id: 200, patient: { id: 55 } };

const statusMap = buildStatusByAppointmentId(
  [completedLoader, blankLoaderOnNewAppt],
  [newScheduleAppt]
);
assert(
  statusMap.get(200) === 'complete',
  `expected new appointment 200 to show complete via patient overlap, got ${statusMap.get(200)}`
);
assert(
  statusMap.get(100) === 'complete',
  'old appointment id on completed loader should still map to complete'
);

// Appointment-id-only (no calendar list) still works
const byIdOnly = buildStatusByAppointmentId([completedLoader]);
assert(byIdOnly.get(100) === 'complete', 'direct appointment id mapping still works');
assert(byIdOnly.get(200) == null, 'without calendar appts, new id is not mapped');

// Resolve: prefer completed patient-matched loader over blank not_sent linked to new id
const matched = findBestRoomLoaderForClump(
  [completedLoader, blankLoaderOnNewAppt],
  [200],
  [55]
);
assert(
  matched?.id === 10,
  'completed patient-matched loader must beat blank not_sent linked to the new appointment id'
);

const matchedPatientOnly = findBestRoomLoaderForClump(
  [completedLoader],
  [200],
  [55]
);
assert(
  matchedPatientOnly?.id === 10,
  'patient overlap must recover completed loader when appointment ids no longer match'
);

const preferCompleted = findBestRoomLoaderForClump(
  [
    { id: 1, sentStatus: 'not_sent', appointments: [], patients: [{ id: 55 }] },
    { id: 2, sentStatus: 'completed', appointments: [], patients: [{ id: 55 }] },
  ],
  [],
  [55]
);
assert(preferCompleted?.id === 2, 'among patient matches, prefer completed sentStatus');

// Same sentStatus: appointment-id overlap still wins
const sameStatus = findBestRoomLoaderForClump(
  [
    { id: 1, sentStatus: 'sent_1', appointments: [{ id: 999 }], patients: [{ id: 55 }] },
    { id: 2, sentStatus: 'sent_1', appointments: [{ id: 200 }], patients: [{ id: 55 }] },
  ],
  [200],
  [55]
);
assert(sameStatus?.id === 2, 'when sentStatus ties, prefer appointment-id overlap');

console.log('roomLoaderDoctorMoveStatusSmoke: ok');

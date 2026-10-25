/**
 * Smoke: Holds → Reschedule must autofill Book appointment Description from the
 * visit being rescheduled (same as schedule reschedule / explore alternatives).
 *
 * Repro (bugs-scout): Holds reschedule left Description blank; schedule paths
 * autofilled. Cause: hold-list sameDayVisits often omit description, source is
 * not in rawAppointments when booking another day, and the book modal ignored
 * defaultDescription whenever rescheduleVisitPatches existed.
 *
 * Run: node scripts/holdsRescheduleDescriptionPrefillSmoke.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function coalesceVisitDescription(existing, incoming) {
  if (existing?.trim()) return existing;
  if (incoming?.trim()) return incoming;
  return existing ?? incoming ?? null;
}

/** Mirrors mergeRescheduleSameDayVisits in holdsOpenInScheduler.ts */
function mergeRescheduleSameDayVisits(...lists) {
  const byPatient = new Map();
  const noPatient = [];
  const seenNoPatientAppt = new Set();

  for (const list of lists) {
    for (const v of list) {
      const patientId = String(v.patientId ?? '').trim();
      if (!patientId) {
        if (seenNoPatientAppt.has(v.appointmentId)) continue;
        seenNoPatientAppt.add(v.appointmentId);
        noPatient.push(v);
        continue;
      }
      const prev = byPatient.get(patientId);
      if (!prev) {
        byPatient.set(patientId, v);
        continue;
      }
      byPatient.set(patientId, {
        ...prev,
        description: coalesceVisitDescription(prev.description, v.description),
        appointmentTypeName: prev.appointmentTypeName?.trim() || v.appointmentTypeName,
        appointmentTypeId: prev.appointmentTypeId ?? v.appointmentTypeId,
        patientName: prev.patientName?.trim() || v.patientName,
      });
    }
  }

  const out = [...byPatient.values()].sort((a, b) =>
    (a.patientName ?? a.patientId).localeCompare(b.patientName ?? b.patientId, undefined, {
      sensitivity: 'base',
    })
  );
  out.push(...noPatient);
  return out;
}

/** Mirrors applyFetchedAppointmentDescriptionToVisits */
function applyFetchedAppointmentDescriptionToVisits(visits, appt) {
  const desc = appt.description?.trim();
  if (!desc) return [...visits];
  return visits.map((v) => {
    if (v.appointmentId !== appt.id) return v;
    if (v.description?.trim()) return v;
    return { ...v, description: appt.description ?? desc };
  });
}

/** Mirrors buildRescheduleVisitPatches description pick + intent enrich in Scheduler. */
function enrichRescheduleVisitPatches(visits, rawAppointments, ri) {
  const patches = visits.map((v) => {
    const appt = rawAppointments.find((a) => a.id === v.appointmentId);
    return {
      appointmentId: v.appointmentId,
      patientId: v.patientId,
      description: appt?.description ?? v.description ?? null,
    };
  });
  const intentDesc = ri?.description?.trim() || '';
  const intentId =
    ri?.appointmentId != null && Number.isFinite(Number(ri.appointmentId))
      ? Number(ri.appointmentId)
      : null;
  return patches.map((p) => {
    if (p.description?.trim()) return p;
    if (intentDesc && intentId != null && Number(p.appointmentId) === intentId) {
      return { ...p, description: intentDesc };
    }
    if (intentDesc && patches.length === 1) {
      return { ...p, description: intentDesc };
    }
    return p;
  });
}

/** Mirrors SchedulerBookModal per-visit description hydrate. */
function hydrateRescheduleVisitDescriptions(patches, defaultDescription) {
  const fallback = defaultDescription?.trim() ?? '';
  const single = patches.length === 1;
  return patches.map((p) => {
    const fromPatch = p.description?.trim() ?? '';
    return fromPatch || (single ? fallback : '');
  });
}

const ORIGINAL_DESC = 'Annual wellness + fecal — keep notes from HOLD';

// --- beginHoldReschedule: blank hold row + fetched appt stamps description ---
{
  const holdVisit = {
    appointmentId: 55,
    patientId: '901',
    patientName: 'Frida',
    description: null,
  };
  const calendarVisit = {
    appointmentId: 55,
    patientId: '901',
    patientName: 'Frida',
    description: ORIGINAL_DESC,
  };
  const merged = applyFetchedAppointmentDescriptionToVisits(
    mergeRescheduleSameDayVisits([holdVisit], [calendarVisit]),
    { id: 55, description: ORIGINAL_DESC }
  );
  assert(
    merged[0]?.description === ORIGINAL_DESC,
    `holds path must carry visit description, got ${JSON.stringify(merged[0]?.description)}`
  );
}

// Fetched appt alone (no calendar sibling / hold description null).
{
  const holdOnly = [{ appointmentId: 55, patientId: '901', description: null }];
  const stamped = applyFetchedAppointmentDescriptionToVisits(holdOnly, {
    id: 55,
    description: ORIGINAL_DESC,
  });
  assert(
    stamped[0].description === ORIGINAL_DESC,
    `fetched appt must stamp blank hold visit, got ${JSON.stringify(stamped[0].description)}`
  );
}

// --- Book path: source not in rawAppointments (other day) still gets intent desc ---
{
  const visits = [{ appointmentId: 55, patientId: '901', description: ORIGINAL_DESC }];
  const patches = enrichRescheduleVisitPatches(visits, /* rawAppointments */ [], {
    appointmentId: 55,
    description: ORIGINAL_DESC,
  });
  assert(
    patches[0].description === ORIGINAL_DESC,
    `patch enrich without calendar row, got ${JSON.stringify(patches[0].description)}`
  );

  const defaultDescription =
    patches.length <= 1
      ? patches[0]?.description?.trim() || ORIGINAL_DESC
      : undefined;
  const hydrated = hydrateRescheduleVisitDescriptions(
    [{ appointmentId: 55, description: null }],
    defaultDescription
  );
  assert(
    hydrated[0] === ORIGINAL_DESC,
    `modal must fall back to defaultDescription when patch blank, got ${JSON.stringify(hydrated[0])}`
  );
}

// Pre-fix: blank patch + ignored defaultDescription → empty Description field.
{
  const broken = hydrateRescheduleVisitDescriptions(
    [{ appointmentId: 55, description: null }],
    undefined
  );
  assert(broken[0] === '', 'pre-fix baseline: blank patch + no fallback → empty');
}

// Source guards in production files.
{
  const holdsUtil = fs.readFileSync(
    path.join(root, 'src/utils/holdsOpenInScheduler.ts'),
    'utf8'
  );
  assert(
    holdsUtil.includes('applyFetchedAppointmentDescriptionToVisits'),
    'holdsOpenInScheduler must stamp fetched appt description onto visits'
  );
  assert(
    holdsUtil.includes('coalesceVisitDescription'),
    'merge must fill blank descriptions from later sources'
  );

  const bookModal = fs.readFileSync(
    path.join(root, 'src/pages/SchedulerBookModal.tsx'),
    'utf8'
  );
  assert(
    bookModal.includes('fallbackDescription'),
    'SchedulerBookModal must fall back to defaultDescription for reschedule patches'
  );

  const scheduler = fs.readFileSync(path.join(root, 'src/pages/Scheduler.tsx'), 'utf8');
  assert(
    scheduler.includes('intentRescheduleDescription'),
    'Scheduler must enrich blank reschedule patches from routing intent description'
  );
}

console.log('holdsRescheduleDescriptionPrefillSmoke: ok');

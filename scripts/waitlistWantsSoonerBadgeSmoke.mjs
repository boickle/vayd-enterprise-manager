/**
 * Smoke: waitlist "Has … — wants sooner" chip for households that already have
 * a calendar visit (bugs-scout thread 1789760948.123809 — Chalmers).
 *
 * Run: node scripts/waitlistWantsSoonerBadgeSmoke.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const utilSrc = fs.readFileSync(path.join(root, 'src/utils/waitlistBookedVisit.ts'), 'utf8');
const normSrc = fs.readFileSync(path.join(root, 'src/utils/waitlistEntryNormalize.ts'), 'utf8');
const waitlistApi = fs.readFileSync(path.join(root, 'src/api/waitlist.ts'), 'utf8');
const pageSrc = fs.readFileSync(path.join(root, 'src/pages/WaitlistPage.tsx'), 'utf8');
const modalSrc = fs.readFileSync(path.join(root, 'src/components/WaitlistAddModal.tsx'), 'utf8');
const prefillSrc = fs.readFileSync(
  path.join(root, 'src/utils/waitlistAddPrefillFromAppointment.ts'),
  'utf8',
);

assert(/export function normalizeWaitlistEntry/.test(normSrc), 'normalizeWaitlistEntry must exist');
assert(
  /bookedAppointment|booked_appointment/.test(normSrc),
  'normalize must flatten nested booked appointment',
);
assert(/normalizeWaitlistEntry/.test(waitlistApi), 'fetchWaitlist must normalize entries');
assert(
  /bookedAppointmentId\?: number/.test(waitlistApi),
  'CreateWaitlistPayload must accept bookedAppointmentId',
);

assert(/bookedAppointmentId/.test(prefillSrc), 'schedule prefill must include appointment id');
assert(/bookedAppointmentStart/.test(prefillSrc), 'schedule prefill must include appointment start');
assert(/bookedAppointmentId/.test(modalSrc), 'add modal must send bookedAppointmentId');
assert(
  /patchWaitlistEntry\(existing/.test(modalSrc),
  'conflict path should try linking booked appointment on existing row',
);

assert(/enrichedBookedStartById/.test(pageSrc), 'WaitlistPage must enrich missing booked starts');
assert(
  /fetchClientAppointmentsStaff/.test(pageSrc),
  'enrichment must load client appointments',
);
assert(
  /waitlistShouldShowWantsSoonerBadge/.test(pageSrc),
  'badge must use shared wants-sooner helper',
);
assert(
  /export function pickSoonestFutureVisitStartIso/.test(utilSrc),
  'pickSoonestFutureVisitStartIso helper must exist',
);

// --- Pure badge helpers (mirror of util, no luxon dependency) ---
function waitlistEffectiveBookedStartIso(entry, enriched) {
  return entry.bookedAppointmentStart?.trim() || enriched?.trim() || null;
}
function waitlistShouldShowWantsSoonerBadge(entry, enriched) {
  if (entry.status !== 'waiting') return false;
  if (entry.createdVia === 'online_booking') return true;
  return Boolean(waitlistEffectiveBookedStartIso(entry, enriched));
}
function waitlistWantsSoonerBadgeText(bookedStartIso, practiceTz) {
  if (!bookedStartIso?.trim()) return 'Wants sooner';
  const dt = new Date(bookedStartIso);
  if (Number.isNaN(dt.getTime())) return 'Wants sooner';
  const label = new Intl.DateTimeFormat('en-US', {
    timeZone: practiceTz,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(dt);
  return `Has ${label} — wants sooner`;
}
function pickSoonestFutureVisitStartIso({ appointments, waitlistPatientIds, nowMs }) {
  const now = nowMs ?? Date.parse('2026-09-18T12:00:00.000Z');
  const want = new Set((waitlistPatientIds ?? []).filter((id) => Number.isFinite(id) && id > 0));
  let best = null;
  for (const appt of appointments) {
    if (appt.isDeleted || appt.isActive === false || appt.allDay || appt.cancelled) continue;
    const startIso = appt.appointmentStart;
    if (!startIso) continue;
    const startMs = Date.parse(startIso);
    if (!Number.isFinite(startMs) || startMs < now - 12 * 60 * 60 * 1000) continue;
    if (want.size > 0) {
      const ids = (appt.patientIds ?? []).filter((id) => Number.isFinite(id));
      if (ids.length > 0 && !ids.some((id) => want.has(id))) continue;
    }
    if (!best || startMs < best.ms) best = { ms: startMs, iso: startIso };
  }
  return best?.iso ?? null;
}

const chalmers = {
  status: 'waiting',
  createdVia: 'staff',
  bookedAppointmentStart: null,
};
assert(
  !waitlistShouldShowWantsSoonerBadge(chalmers, null),
  'staff row without booked start should not badge',
);
const enriched = pickSoonestFutureVisitStartIso({
  appointments: [
    {
      appointmentStart: '2026-09-23T16:40:00.000Z',
      patientIds: [42],
      isDeleted: false,
      isActive: true,
      allDay: false,
    },
  ],
  waitlistPatientIds: [42],
  nowMs: Date.parse('2026-09-18T12:00:00.000Z'),
});
assert(enriched === '2026-09-23T16:40:00.000Z', 'should pick Mickey 9/23 visit');
assert(
  waitlistShouldShowWantsSoonerBadge(chalmers, enriched),
  'enriched schedule start should show wants-sooner badge',
);
assert(
  /Sep 23/.test(waitlistWantsSoonerBadgeText(enriched, 'America/New_York')),
  'badge text should include Sep 23',
);

const karins = {
  status: 'waiting',
  createdVia: 'online_booking',
  bookedAppointmentStart: '2026-09-29T15:00:00.000Z',
};
assert(waitlistShouldShowWantsSoonerBadge(karins, null), 'online booking / booked start still badges');

console.log('waitlistWantsSoonerBadgeSmoke: ok');

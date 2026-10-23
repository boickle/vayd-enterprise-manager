/**
 * Smoke: Multi-pet forward booking / care outreach must prefill each pet's
 * Book appointment Description from that pet's own bookingNotes — not the
 * household anchor's notes.
 *
 * Repro (bugs-scout): Morgan — Alvin + Little Puff both got Alvin's
 * "Care outreach follow-up: FVRCP…" text even though Little Puff's reminders
 * are Senior Wellness + Rabies (RV).
 *
 * Run: node scripts/forwardBookingMultiPetDescriptionPrefillSmoke.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/** Mirrors src/utils/forwardBookingBookPrefillDescription.ts */
function resolveForwardBookingBookDefaultDescription(intent) {
  if (!intent) return undefined;
  const fromNotes = intent.bookingNotes?.trim();
  if (fromNotes) return fromNotes;
  const fromDesc = intent.description?.trim();
  if (fromDesc) return fromDesc;
  return undefined;
}

function resolveForwardBookingVisitDescriptionsByPatientId(entries) {
  const byPatient = new Map();
  for (const entry of entries ?? []) {
    const patientId = String(entry.patientId ?? '').trim();
    if (!patientId) continue;
    const text = resolveForwardBookingBookDefaultDescription(entry);
    if (!text) continue;
    byPatient.set(patientId, text);
  }
  return byPatient;
}

/** Mirrors Scheduler openRoutingBookForm Description wiring for FB books. */
function bookPrefillDescriptions({ fbi, fbiGroupBook, fbiTargets }) {
  const defaultDescription =
    fbi && !fbiGroupBook ? resolveForwardBookingBookDefaultDescription(fbi) : undefined;
  const visitCompletes =
    fbiTargets && fbiTargets.entries.length > 1
      ? fbiTargets.entries.map((row) => ({
          patientId: row.patientId,
          description: resolveForwardBookingBookDefaultDescription(row),
        }))
      : undefined;
  return { defaultDescription, visitCompletes };
}

/** Mirrors SchedulerBookModal per-row Description choice. */
function descriptionForPatient(patientId, { defaultDescription, visitCompletes }) {
  const fbDescriptionByPatientId = new Map();
  for (const row of visitCompletes ?? []) {
    const id = String(row.patientId).trim();
    const fbDesc = row.description?.trim();
    if (id && fbDesc) fbDescriptionByPatientId.set(id, fbDesc);
  }
  return fbDescriptionByPatientId.get(patientId) ?? defaultDescription?.trim() ?? '';
}

const ALVIN_NOTES =
  'Care outreach follow-up: FVRCP Vaccination - 3 year; Annual Wellness Visit; Stool Parasite Check - please have sample at visit';
const LITTLE_PUFF_NOTES =
  'Care outreach follow-up: Senior Wellness Exam; Rabies Feline (Purevax) - 1 year';

const householdEntries = [
  {
    forwardBookingId: 1,
    trackingToken: 't1',
    patientId: '101',
    patientName: 'Alvin',
    bookingNotes: ALVIN_NOTES,
  },
  {
    forwardBookingId: 2,
    trackingToken: 't2',
    patientId: '102',
    patientName: 'Little Puff',
    bookingNotes: LITTLE_PUFF_NOTES,
  },
];

const fbi = {
  forwardBookingId: 1,
  patientId: '101',
  bookingNotes: ALVIN_NOTES,
  householdEntries,
};

// Map helper: each pet keeps their own notes.
{
  const byId = resolveForwardBookingVisitDescriptionsByPatientId(householdEntries);
  assert(byId.get('101') === ALVIN_NOTES, 'Alvin should keep FVRCP notes');
  assert(byId.get('102') === LITTLE_PUFF_NOTES, 'Little Puff should keep RV notes');
  assert(byId.size === 2, 'expected two pet descriptions');
}

// Multi-pet book: no shared defaultDescription; visit completes carry per-pet text.
{
  const prefill = bookPrefillDescriptions({
    fbi,
    fbiGroupBook: true,
    fbiTargets: { entries: householdEntries },
  });
  assert(
    prefill.defaultDescription === undefined,
    `multi-pet must not share anchor Description, got ${JSON.stringify(prefill.defaultDescription)}`
  );
  assert(prefill.visitCompletes?.length === 2, 'expected two visit completes');
  assert(
    descriptionForPatient('101', prefill) === ALVIN_NOTES,
    'Alvin Description mismatch'
  );
  assert(
    descriptionForPatient('102', prefill) === LITTLE_PUFF_NOTES,
    'Little Puff Description mismatch'
  );
  assert(
    descriptionForPatient('103', prefill) === '',
    'non-FB household pet should not inherit Alvin notes'
  );
}

// Single-pet book: still uses intent defaultDescription.
{
  const prefill = bookPrefillDescriptions({
    fbi,
    fbiGroupBook: false,
    fbiTargets: { entries: [householdEntries[0]] },
  });
  assert(prefill.defaultDescription === ALVIN_NOTES, 'single-pet keeps defaultDescription');
  assert(prefill.visitCompletes === undefined, 'single-pet skips visit completes');
}

// Guard: household entries carry bookingNotes; Scheduler wires per-pet description.
{
  const intentUtil = fs.readFileSync(
    path.join(root, 'src/utils/routingForwardBookingIntent.ts'),
    'utf8'
  );
  assert(
    intentUtil.includes('bookingNotes: entry.bookingNotes ?? null'),
    'householdEntryFromForwardBookingRow must copy bookingNotes'
  );

  const scheduler = fs.readFileSync(path.join(root, 'src/pages/Scheduler.tsx'), 'utf8');
  assert(
    scheduler.includes('fbi && !isReschedule && !fbiGroupBook'),
    'Scheduler must not set shared defaultDescription for multi-pet FB books'
  );
  assert(
    scheduler.includes('description: resolveForwardBookingBookDefaultDescription(row)'),
    'Scheduler must set per-pet description on forwardBookingVisitCompletes'
  );

  const bookModal = fs.readFileSync(
    path.join(root, 'src/pages/SchedulerBookModal.tsx'),
    'utf8'
  );
  assert(
    bookModal.includes('fbDescriptionByPatientId'),
    'Book modal must apply per-pet FB Description'
  );

  const util = fs.readFileSync(
    path.join(root, 'src/utils/forwardBookingBookPrefillDescription.ts'),
    'utf8'
  );
  assert(
    util.includes('resolveForwardBookingVisitDescriptionsByPatientId'),
    'helper must expose per-pet description map'
  );
}

console.log('forwardBookingMultiPetDescriptionPrefillSmoke: ok');

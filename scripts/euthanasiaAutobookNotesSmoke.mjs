/**
 * Smoke: euthanasia auto-book calendar notes should include the reason
 * like regular visits (needsTodayDetails / visitDetails).
 *
 * Bug: Laura Rigby / Dutch (Slack #bugs-scout 1792589839.681169) —
 * request had euthanasiaReason, HOLD description was only
 * "Online Booking - Laura Rigby. Dutch."
 *
 * Run: node scripts/euthanasiaAutobookNotesSmoke.mjs
 *
 * Mirrors:
 * - src/utils/appointmentRequestEuthanasiaAutobookNotes.ts
 * - formatAppointmentRequestPetStaffNoteLines dedupe
 * - AppointmentRequestForm sanitize / top-level visitDetails mirror
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function trimNonEmpty(value) {
  if (value == null) return undefined;
  const s = String(value).trim();
  return s || undefined;
}

function withEuthanasiaReasonMirroredToNeedsTodayDetails(petData) {
  const reason = trimNonEmpty(petData.euthanasiaReason);
  if (!reason) return petData;
  if (trimNonEmpty(petData.needsTodayDetails)) return petData;
  return { ...petData, needsTodayDetails: reason };
}

function withEuthanasiaReasonMirroredToVisitDetails(opts) {
  const reason = trimNonEmpty(opts.euthanasiaReason);
  if (!reason) return {};
  if (trimNonEmpty(opts.visitDetails)) return {};
  return { visitDetails: reason };
}

function formatAppointmentRequestPetStaffNoteLines(notes) {
  const lines = [];
  const details = notes.needsTodayDetails?.trim();
  const euthReason = notes.euthanasiaReason?.trim();
  if (details && details !== euthReason) lines.push(details);
  if (euthReason) lines.push(euthReason);
  return lines;
}

const REASON =
  'Dutch has been slowing down for a while now. His back legs have been giving out frequently.';

{
  const out = withEuthanasiaReasonMirroredToNeedsTodayDetails({
    euthanasiaReason: REASON,
    beenToVetLastThreeMonths: 'No',
  });
  assert(out.needsTodayDetails === REASON, 'mirrors euthanasiaReason into needsTodayDetails');
  assert(out.euthanasiaReason === REASON, 'keeps canonical euthanasiaReason');
}

{
  const out = withEuthanasiaReasonMirroredToNeedsTodayDetails({
    euthanasiaReason: REASON,
    needsTodayDetails: 'already set separately',
  });
  assert(
    out.needsTodayDetails === 'already set separately',
    'does not overwrite an existing needsTodayDetails',
  );
}

{
  const out = withEuthanasiaReasonMirroredToVisitDetails({ euthanasiaReason: REASON });
  assert(out.visitDetails === REASON, 'mirrors top-level euthanasiaReason into visitDetails');
}

{
  const lines = formatAppointmentRequestPetStaffNoteLines({
    needsTodayDetails: REASON,
    euthanasiaReason: REASON,
  });
  assert(lines.length === 1 && lines[0] === REASON, 'staff notes dedupe mirrored reason');
}

{
  const lines = formatAppointmentRequestPetStaffNoteLines({
    needsTodayDetails: 'Wellness checkup details',
    euthanasiaReason: null,
  });
  assert(lines.length === 1 && lines[0] === 'Wellness checkup details', 'regular visit details unchanged');
}

// Source wiring
const formSrc = fs.readFileSync(
  path.join(root, 'src/pages/AppointmentRequestForm.tsx'),
  'utf8',
);
assert(
  formSrc.includes('withEuthanasiaReasonMirroredToNeedsTodayDetails'),
  'form sanitizes euthanasia pets with needsTodayDetails mirror',
);
assert(
  formSrc.includes('withEuthanasiaReasonMirroredToVisitDetails'),
  'form mirrors top-level euthanasiaReason into visitDetails',
);

const utilSrc = fs.readFileSync(
  path.join(root, 'src/utils/appointmentRequestEuthanasiaAutobookNotes.ts'),
  'utf8',
);
assert(utilSrc.includes('needsTodayDetails: reason'), 'util writes needsTodayDetails');

const notesSrc = fs.readFileSync(
  path.join(root, 'src/utils/appointmentRequestPetStaffNotes.ts'),
  'utf8',
);
assert(
  notesSrc.includes('details !== euthReason'),
  'staff note formatter dedupes mirrored reason',
);

const detailSrc = fs.readFileSync(
  path.join(root, 'src/utils/appointmentRequestDetailDisplay.ts'),
  'utf8',
);
assert(
  detailSrc.includes('details !== euthReason'),
  'request detail hides duplicate Visit details row',
);
assert(
  detailSrc.includes('visitDetails !== topEuthReason'),
  'request detail hides duplicate top-level Visit details',
);

console.log('euthanasiaAutobookNotesSmoke: ok');

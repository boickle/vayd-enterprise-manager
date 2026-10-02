/**
 * Smoke: Forward booking note (bookingNotes) must prefill Book appointment → Description.
 *
 * Repro (bugs-scout): Stephanie Philbrick / Frida — forward booking note
 * "tech appt in December for Frida RV purevax 3yr…" did not appear in the
 * HOLD Description field when booking from Get Best Route.
 *
 * Regression: openRoutingBookForm used to pass fbi.description (and bookingNotes
 * into Staff notes); a later change dropped both. Product copy on Add forward
 * booking still says the note is "prefilled when booking the follow-up visit."
 *
 * Run: node scripts/forwardBookingNoteDescriptionPrefillSmoke.mjs
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

/** Mirrors Scheduler openRoutingBookForm defaultDescription branch. */
function defaultDescriptionForRoutingBook({ isReschedule, rescheduleDescription, fbi }) {
  if (isReschedule) {
    return rescheduleDescription?.trim() || undefined;
  }
  if (fbi) {
    return resolveForwardBookingBookDefaultDescription(fbi);
  }
  return undefined;
}

const FRIDA_NOTE =
  'tech appt in December for Frida RV purevax 3yr and FVRCP 3yr, we are doing them early as TA to get her on the same schedule as Finn';

// Primary: bookingNotes → Description when placing a forward-booking HOLD.
{
  const got = defaultDescriptionForRoutingBook({
    isReschedule: false,
    fbi: { bookingNotes: FRIDA_NOTE, description: null },
  });
  assert(got === FRIDA_NOTE, `expected bookingNotes in Description, got ${JSON.stringify(got)}`);
}

// Prefer bookingNotes over legacy description.
{
  const got = resolveForwardBookingBookDefaultDescription({
    bookingNotes: '  vaccines early  ',
    description: 'source visit desc',
  });
  assert(got === 'vaccines early', `prefer bookingNotes, got ${JSON.stringify(got)}`);
}

// Fall back to description when bookingNotes empty.
{
  const got = resolveForwardBookingBookDefaultDescription({
    bookingNotes: '   ',
    description: '  legacy desc  ',
  });
  assert(got === 'legacy desc', `fallback description, got ${JSON.stringify(got)}`);
}

// Empty / missing → undefined (leave Description blank).
{
  assert(
    resolveForwardBookingBookDefaultDescription({ bookingNotes: null, description: '' }) ===
      undefined,
    'empty should be undefined'
  );
  assert(resolveForwardBookingBookDefaultDescription(null) === undefined, 'null intent');
}

// Reschedule path must not pull forward-booking notes.
{
  const got = defaultDescriptionForRoutingBook({
    isReschedule: true,
    rescheduleDescription: 'existing visit notes',
    fbi: { bookingNotes: FRIDA_NOTE },
  });
  assert(got === 'existing visit notes', `reschedule must keep visit desc, got ${got}`);
}

// Non-forward-booking routing book stays blank.
{
  const got = defaultDescriptionForRoutingBook({
    isReschedule: false,
    fbi: null,
  });
  assert(got === undefined, `no fbi should leave Description empty, got ${got}`);
}

// Guard: Scheduler still wires the helper for forward-booking books.
{
  const scheduler = fs.readFileSync(path.join(root, 'src/pages/Scheduler.tsx'), 'utf8');
  assert(
    scheduler.includes('resolveForwardBookingBookDefaultDescription'),
    'Scheduler must call resolveForwardBookingBookDefaultDescription'
  );
  assert(
    scheduler.includes('fbi && !isReschedule'),
    'Scheduler must prefill Description for forward-booking (non-reschedule) books'
  );
  const util = fs.readFileSync(
    path.join(root, 'src/utils/forwardBookingBookPrefillDescription.ts'),
    'utf8'
  );
  assert(
    util.includes('bookingNotes'),
    'helper must prefer bookingNotes (Forward booking note)'
  );
}

console.log('forwardBookingNoteDescriptionPrefillSmoke: ok');

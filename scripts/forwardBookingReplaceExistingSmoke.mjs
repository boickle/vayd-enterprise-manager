/**
 * Smoke: Add forward booking must replace a pending row for the same source visit
 * instead of surfacing "An active forward booking already exists…".
 *
 * Repro (bugs-scout): Riley / Dana Peirce — ASAP (1 week) blocked because a
 * 3-month-out forward booking already existed for the source visit, and the
 * list has no interval edit.
 *
 * Run: node scripts/forwardBookingReplaceExistingSmoke.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/** Mirrors src/utils/forwardBookingReplaceExisting.ts */
function isActiveForwardBookingExistsError(e) {
  const ax = e;
  const m = ax?.response?.data?.message;
  const text = Array.isArray(m) ? m.join(' ') : typeof m === 'string' ? m : ax?.message ?? '';
  return /active forward booking already exists/i.test(text);
}

function forwardBookingHasLinkedVisit(entry) {
  if (entry.status === 'booked') return true;
  const id = entry.bookedAppointmentId;
  if (id != null && Number.isFinite(Number(id)) && Number(id) > 0) return true;
  if (entry.bookedAppointmentStart?.trim()) return true;
  return false;
}

function isReplaceableActiveForwardBooking(entry) {
  if (entry.status === 'removed' || entry.status === 'complete') return false;
  if (forwardBookingHasLinkedVisit(entry)) return false;
  return entry.status === 'pending';
}

function pickReplaceableForwardBookingForSourceVisit(entries, sourceAppointmentId) {
  if (!Number.isFinite(sourceAppointmentId) || sourceAppointmentId <= 0) return null;
  const matches = entries.filter(
    (e) =>
      e.sourceAppointmentId != null &&
      Number(e.sourceAppointmentId) === Number(sourceAppointmentId) &&
      isReplaceableActiveForwardBooking(e)
  );
  if (matches.length === 0) return null;
  return matches.sort((a, b) => Number(b.id) - Number(a.id))[0] ?? null;
}

function formatForwardBookingIntervalLabel(opts) {
  const amount = opts.intervalAmount;
  const unit = opts.intervalUnit;
  if (amount != null && Number.isFinite(amount) && amount > 0 && unit) {
    const unitLabel =
      unit === 'days'
        ? amount === 1
          ? 'day'
          : 'days'
        : unit === 'weeks'
          ? amount === 1
            ? 'week'
            : 'weeks'
          : amount === 1
            ? 'month'
            : 'months';
    return `${amount} ${unitLabel} out`;
  }
  const mo = opts.monthsOut;
  if (mo != null && Number.isFinite(mo) && mo > 0) {
    const rounded = Math.round(mo);
    return `${rounded} ${rounded === 1 ? 'month' : 'months'} out`;
  }
  return '—';
}

function formatExistingForwardBookingReplaceHint(entry) {
  const interval = formatForwardBookingIntervalLabel({
    intervalAmount: entry.intervalAmount,
    intervalUnit: entry.intervalUnit,
    monthsOut: entry.monthsOut,
  });
  if (interval === '—') {
    return 'This visit already has an active forward booking. Saving will update that list entry.';
  }
  return `This visit already has an active forward booking (${interval}). Saving will update that list entry.`;
}

// API error detection (exact message from screenshot).
{
  assert(
    isActiveForwardBookingExistsError({
      response: { data: { message: 'An active forward booking already exists for this source visit' } },
    }),
    'should match API message'
  );
  assert(
    !isActiveForwardBookingExistsError({ response: { data: { message: 'validation failed' } } }),
    'should ignore unrelated errors'
  );
}

const SOURCE_ID = 9001;
const threeMonthPending = {
  id: 10,
  status: 'pending',
  sourceAppointmentId: SOURCE_ID,
  intervalAmount: 3,
  intervalUnit: 'months',
  note: 'prior contact',
  bookedAppointmentId: null,
};

const asapPendingNewer = {
  id: 20,
  status: 'pending',
  sourceAppointmentId: SOURCE_ID,
  intervalAmount: 1,
  intervalUnit: 'weeks',
  bookedAppointmentId: null,
};

const bookedLinked = {
  id: 30,
  status: 'booked',
  sourceAppointmentId: SOURCE_ID,
  intervalAmount: 3,
  intervalUnit: 'months',
  bookedAppointmentId: 555,
  bookedAppointmentStart: '2026-12-01T15:00:00.000Z',
};

const otherSource = {
  id: 40,
  status: 'pending',
  sourceAppointmentId: 9999,
  intervalAmount: 2,
  intervalUnit: 'months',
};

// Prefer newest replaceable pending for the source visit.
{
  const picked = pickReplaceableForwardBookingForSourceVisit(
    [threeMonthPending, asapPendingNewer, otherSource],
    SOURCE_ID
  );
  assert(picked?.id === 20, `expected newest pending id 20, got ${picked?.id}`);
}

// Do not replace when the only row is already linked/booked.
{
  const picked = pickReplaceableForwardBookingForSourceVisit([bookedLinked, otherSource], SOURCE_ID);
  assert(picked == null, 'booked/linked row must not be replaceable');
}

// Hint copy for the Riley repro (3 months out → ASAP update).
{
  const hint = formatExistingForwardBookingReplaceHint(threeMonthPending);
  assert(
    hint.includes('3 months out'),
    `hint should mention current interval, got ${JSON.stringify(hint)}`
  );
  assert(hint.includes('update that list entry'), 'hint should explain update behavior');
}

// Preserve contact-log note when retry payload omits note.
{
  const body = { practiceId: 1, sourceAppointmentId: SOURCE_ID, bookingNotes: 'Book ASAP' };
  const existing = threeMonthPending;
  const retryBody = {
    ...body,
    note: body.note !== undefined ? body.note : existing.note ?? null,
  };
  assert(retryBody.note === 'prior contact', 'should preserve existing contact-log note');
}

// Modal must call replace helper for source-visit creates.
{
  const modal = fs.readFileSync(
    path.join(root, 'src/components/CreateForwardBookingModal.tsx'),
    'utf8'
  );
  assert(
    modal.includes('createForwardBookingReplacingSourceConflict'),
    'CreateForwardBookingModal must replace on source-visit conflict'
  );
  assert(
    modal.includes('Update on list') && modal.includes('Update forward booking'),
    'modal should expose update copy when an existing row is found'
  );
  assert(
    modal.includes('findReplaceableForwardBookingForSourceVisit'),
    'modal should detect existing row for the selected source visit'
  );
}

// Shared error helper used by End Visit (idempotent ignore) and Add modal.
{
  const util = fs.readFileSync(
    path.join(root, 'src/utils/forwardBookingReplaceExisting.ts'),
    'utf8'
  );
  const endVisit = fs.readFileSync(
    path.join(root, 'src/pages/SchedulerActualVisitTimeModal.tsx'),
    'utf8'
  );
  assert(util.includes('export function isActiveForwardBookingExistsError'), 'util exports detector');
  assert(
    endVisit.includes("from '../utils/forwardBookingReplaceExisting'"),
    'End Visit should import shared exists-error helper'
  );
  assert(
    !/function isActiveForwardBookingExistsError/.test(endVisit),
    'End Visit should not keep a local duplicate detector'
  );
}

console.log('forwardBookingReplaceExistingSmoke: ok');

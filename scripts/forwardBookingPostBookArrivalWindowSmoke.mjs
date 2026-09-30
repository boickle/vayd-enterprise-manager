/**
 * Smoke: Forward-booking post-hold SMS must use the client arrival window
 * (type ±N, default ±60), not the scheduled service block.
 *
 * Repro (bugs-scout): Jackie Porcello-Smith / Penny — SMS said
 * 11:15 AM–12:00 PM (45m service) instead of the two-hour arrival window.
 *
 * Run: node scripts/forwardBookingPostBookArrivalWindowSmoke.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function isFixedTimeTypeName(name) {
  const lower = String(name ?? '')
    .trim()
    .toLowerCase();
  return lower === 'fixed time' || lower.includes('fixed time');
}

/** Format a UTC ISO instant as h:mm a in America/New_York. */
function formatEtTime(iso) {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(d);
  const hour = parts.find((p) => p.type === 'hour')?.value;
  const minute = parts.find((p) => p.type === 'minute')?.value;
  const dayPeriod = parts.find((p) => p.type === 'dayPeriod')?.value?.toUpperCase();
  return `${hour}:${minute} ${dayPeriod}`;
}

/** Mirrors computedArrivalWindowFromAppointmentType (±N around scheduled start). */
function arrivalWindowFromScheduledStart(appointmentStart, appointmentEnd, type) {
  const typeName = (type?.name || type?.prettyName || '').trim();
  if (isFixedTimeTypeName(typeName)) {
    return { startIso: appointmentStart, endIso: appointmentEnd };
  }
  const before = type?.windowBeforeMinutes ?? 60;
  const after = type?.windowAfterMinutes ?? 60;
  const startMs = Date.parse(appointmentStart);
  return {
    startIso: new Date(startMs - before * 60_000).toISOString(),
    endIso: new Date(startMs + after * 60_000).toISOString(),
  };
}

// Jackie / Penny: scheduled 11:15–12:00 ET (45m service); expected ±60 → 10:15–12:15.
{
  const appointmentStart = '2026-10-27T15:15:00.000Z'; // 11:15 AM ET (EDT)
  const appointmentEnd = '2026-10-27T16:00:00.000Z'; // 12:00 PM ET

  const buggyStart = formatEtTime(appointmentStart);
  const buggyEnd = formatEtTime(appointmentEnd);
  assert(buggyStart === '11:15 AM', `buggy start got ${buggyStart}`);
  assert(buggyEnd === '12:00 PM', `buggy end got ${buggyEnd}`);

  const win = arrivalWindowFromScheduledStart(appointmentStart, appointmentEnd, null);
  const fixedStart = formatEtTime(win.startIso);
  const fixedEnd = formatEtTime(win.endIso);
  assert(fixedStart === '10:15 AM', `expected 10:15 AM, got ${fixedStart}`);
  assert(fixedEnd === '12:15 PM', `expected 12:15 PM, got ${fixedEnd}`);
}

// Fixed Time keeps the clock block.
{
  const start = '2026-10-27T15:15:00.000Z';
  const end = '2026-10-27T16:00:00.000Z';
  const win = arrivalWindowFromScheduledStart(start, end, { name: 'Fixed Time' });
  assert(formatEtTime(win.startIso) === '11:15 AM');
  assert(formatEtTime(win.endIso) === '12:00 PM');
}

// Source wiring: post-book forward booking SMS must not format service end as the window.
{
  const page = fs.readFileSync(path.join(root, 'src/pages/ForwardBookingPage.tsx'), 'utf8');
  assert(
    page.includes('formatForwardBookingSmsBookedSlotFromEntry'),
    'ForwardBookingPage must fall back via formatForwardBookingSmsBookedSlotFromEntry'
  );
  assert(
    page.includes('resolveForwardBookingSmsBookedSlot'),
    'ForwardBookingPage must resolve arrival window before opening SMS'
  );
  assert(
    !/formatForwardBookingSmsBookedSlot\(\s*pending\.bookedAppointmentStart/.test(page),
    'ForwardBookingPage must not pass bookedAppointmentStart/End directly as the SMS window'
  );

  const waitlist = fs.readFileSync(path.join(root, 'src/utils/waitlistSmsMessage.ts'), 'utf8');
  assert(
    waitlist.includes('formatForwardBookingSmsBookedSlotFromAppointment'),
    'waitlist SMS fallback must use formatForwardBookingSmsBookedSlotFromAppointment'
  );
  assert(
    !/formatForwardBookingSmsBookedSlot\(\s*fallback\.startIso/.test(waitlist),
    'waitlist SMS must not pass fallback start/end directly as the window'
  );

  const scheduleLoader = fs.readFileSync(
    path.join(root, 'src/utils/scheduleLoaderSmsMessage.ts'),
    'utf8'
  );
  assert(
    scheduleLoader.includes('formatForwardBookingSmsBookedSlotFromAppointment'),
    'schedule-loader SMS fallback must use formatForwardBookingSmsBookedSlotFromAppointment'
  );
  assert(
    !/formatForwardBookingSmsBookedSlot\(\s*fallback\.startIso/.test(scheduleLoader),
    'schedule-loader SMS must not pass fallback start/end directly as the window'
  );
}

console.log('forwardBookingPostBookArrivalWindowSmoke: ok');

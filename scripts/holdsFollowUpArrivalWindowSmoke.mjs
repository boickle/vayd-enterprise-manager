/**
 * Smoke: Holds follow-up SMS/email must use the client arrival window, not the
 * scheduled service block (appointmentStart → appointmentEnd).
 *
 * Repro (bugs-scout): Willow Gilbert hold showed 10:25 AM–12:25 PM on the
 * schedule, but hold follow-up email said 11:25 AM–12:10 PM (service duration).
 *
 * Run: node scripts/holdsFollowUpArrivalWindowSmoke.mjs
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

/** Format a UTC ISO instant as h:mm a in America/New_York (EST/EDT via offset). */
function formatEtTime(iso) {
  const d = new Date(iso);
  // America/New_York: use Intl so DST is correct for the appointment date.
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

// Willow: scheduled 11:25–12:10 ET (45m service); schedule card window 10:25–12:25 (±60).
{
  const appointmentStart = '2026-11-11T16:25:00.000Z'; // 11:25 AM ET
  const appointmentEnd = '2026-11-11T17:10:00.000Z'; // 12:10 PM ET

  const buggyStart = formatEtTime(appointmentStart);
  const buggyEnd = formatEtTime(appointmentEnd);
  assert(buggyStart === '11:25 AM', `buggy start got ${buggyStart}`);
  assert(buggyEnd === '12:10 PM', `buggy end got ${buggyEnd}`);

  const win = arrivalWindowFromScheduledStart(appointmentStart, appointmentEnd, { name: 'OOSA' });
  const fixedStart = formatEtTime(win.startIso);
  const fixedEnd = formatEtTime(win.endIso);
  assert(fixedStart === '10:25 AM', `expected 10:25 AM, got ${fixedStart}`);
  assert(fixedEnd === '12:25 PM', `expected 12:25 PM, got ${fixedEnd}`);
}

// Fixed Time keeps the clock block.
{
  const start = '2026-11-11T16:25:00.000Z';
  const end = '2026-11-11T17:10:00.000Z';
  const win = arrivalWindowFromScheduledStart(start, end, { name: 'Fixed Time' });
  assert(formatEtTime(win.startIso) === '11:25 AM');
  assert(formatEtTime(win.endIso) === '12:10 PM');
}

// Custom Pre-Meds-style windows (±90 / +30) must not collapse to service end.
{
  const start = '2026-11-11T16:25:00.000Z';
  const end = '2026-11-11T17:10:00.000Z';
  const win = arrivalWindowFromScheduledStart(start, end, {
    name: 'Pre-Meds',
    windowBeforeMinutes: 90,
    windowAfterMinutes: 30,
  });
  assert(formatEtTime(win.startIso) === '9:55 AM');
  assert(formatEtTime(win.endIso) === '11:55 AM');
}

// Source wiring: holds SMS must not format service end as the window.
{
  const holdsSms = fs.readFileSync(path.join(root, 'src/utils/holdsSmsMessage.ts'), 'utf8');
  assert(
    holdsSms.includes('formatForwardBookingSmsBookedSlotFromAppointment'),
    'holdsSmsMessage must use formatForwardBookingSmsBookedSlotFromAppointment'
  );
  assert(
    holdsSms.includes('bookedSlotFromHoldListItem'),
    'holdsSmsMessage must expose bookedSlotFromHoldListItem'
  );
  assert(
    holdsSms.includes('resolveHoldSmsBookedSlot'),
    'holdsSmsMessage must resolve window from appointment when possible'
  );
  assert(
    !/formatForwardBookingSmsBookedSlot\(\s*slotHold\.appointmentStart/.test(holdsSms),
    'holdsSmsMessage must not pass appointmentStart/End directly as the SMS window'
  );

  const holdsPage = fs.readFileSync(path.join(root, 'src/pages/HoldsPage.tsx'), 'utf8');
  assert(
    holdsPage.includes('resolveHoldSmsBookedSlot'),
    'HoldsPage must resolve arrival window when opening SMS/email'
  );
}

console.log('holdsFollowUpArrivalWindowSmoke: ok');

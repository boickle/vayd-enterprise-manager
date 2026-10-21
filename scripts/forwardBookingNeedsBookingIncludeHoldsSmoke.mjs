/**
 * Smoke: Forward booking Needs booking must exclude HOLDs by default, with an
 * opt-in "Include HOLDs" checkbox, and search must stay scoped to the active tab.
 *
 * Repro (#bugs-scout): Needs booking search mixed On hold / Booked rows
 * ("Searching across all tabs"); staff wanted Needs booking = no hold yet,
 * with an optional Include HOLDs toggle and CL who placed the hold.
 *
 * Run: node scripts/forwardBookingNeedsBookingIncludeHoldsSmoke.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const pagePath = path.join(root, 'src/pages/ForwardBookingPage.tsx');
const visibilityPath = path.join(root, 'src/utils/forwardBookingListVisibility.ts');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const page = fs.readFileSync(pagePath, 'utf8');
const visibility = fs.readFileSync(visibilityPath, 'utf8');

assert(
  /INCLUDE_HOLDS_SEARCH_PARAM\s*=\s*'includeHolds'/.test(page),
  'Needs booking Include HOLDs must use includeHolds URL param'
);
assert(/Include HOLDs/.test(page), 'ForwardBookingPage must show Include HOLDs checkbox label');
assert(
  /includeHoldsInNeedsBooking/.test(page),
  'ForwardBookingPage must track includeHoldsInNeedsBooking'
);
assert(
  /forwardBookingMatchesStatusFilter/.test(page),
  'List/search filter must use forwardBookingMatchesStatusFilter'
);
assert(
  !/Searching across all tabs/.test(page),
  'Must not advertise Searching across all tabs'
);
assert(
  /Searching Needs booking \(\+ holds\)/.test(page),
  'Search hint must call out Needs booking (+ holds) when Include HOLDs is on'
);
assert(
  /By \{employeeLabel\(entry\.bookedBy\)\}/.test(page),
  'On-hold rows must show By {CL} chip like the holds board'
);
assert(
  /export function forwardBookingMatchesStatusFilter/.test(visibility),
  'forwardBookingMatchesStatusFilter helper must exist'
);
assert(
  /includeHoldsInNeedsBooking\?:/.test(visibility),
  'Status filter helper must support includeHoldsInNeedsBooking'
);
assert(
  /statusFilter === 'pending'[\s\S]*?tab === 'onHold'/.test(visibility),
  'Helper must only pull onHold rows into Needs booking when opted in'
);

console.log('forwardBookingNeedsBookingIncludeHoldsSmoke: ok');

/**
 * Smoke: waitlist Recommend slot for a linked visit ("Has … — wants sooner")
 * must open Explore alternatives (keep original + HOLD prompt path), not a
 * forward-booking create/reschedule move.
 *
 * Repro (bugs-scout thread 1790347439.632169): offering a sooner appt from the
 * waitlist moved like a reschedule; staff wanted explore-alternative behavior.
 *
 * Run: node scripts/waitlistExploreAlternativesSmoke.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const utilSrc = fs.readFileSync(
  path.join(root, 'src/utils/waitlistExploreAlternatives.ts'),
  'utf8',
);
const pageSrc = fs.readFileSync(path.join(root, 'src/pages/WaitlistPage.tsx'), 'utf8');
const intentSrc = fs.readFileSync(
  path.join(root, 'src/utils/routingRescheduleIntent.ts'),
  'utf8',
);

assert(
  /export async function startExploreAlternativesFromWaitlist/.test(utilSrc),
  'util must export startExploreAlternativesFromWaitlist',
);
assert(
  /exploreAlternatives:\s*true/.test(utilSrc),
  'waitlist sooner path must set exploreAlternatives',
);
assert(
  /writeRoutingRescheduleIntent/.test(utilSrc),
  'must write a reschedule (explore) intent, not only forward booking',
);
assert(
  /clearRoutingForwardBookingIntent/.test(utilSrc),
  'must clear any leftover forward-booking intent before explore',
);
assert(
  /filterSameDayVisitsForWaitlistPets/.test(utilSrc),
  'must filter household-day pets to the waitlist row when possible',
);
assert(
  /routingSearch/.test(utilSrc) && /waitlistRoutingSearchDateRange/.test(utilSrc),
  'must carry fill-a-cancellation date window onto the explore intent',
);

assert(
  /startExploreAlternativesFromWaitlist/.test(pageSrc),
  'WaitlistPage must call startExploreAlternativesFromWaitlist',
);
assert(
  /bookedAppointmentId/.test(pageSrc) &&
    /startExploreAlternativesFromWaitlist/.test(pageSrc),
  'Recommend slot must branch on bookedAppointmentId',
);
assert(
  /createForwardBookingsFromWaitlist/.test(pageSrc),
  'entries without a linked visit still use forward-booking Recommend slot',
);

assert(
  /routingSearch\?:/.test(intentSrc),
  'reschedule intent must accept optional routingSearch for list-driven windows',
);
assert(
  /intent\.routingSearch\?\.startDate/.test(intentSrc),
  'rescheduleIntentDefaultDateRange must prefer routingSearch when set',
);

/** Mirror of filterSameDayVisitsForWaitlistPets */
function filterSameDayVisitsForWaitlistPets(visits, waitlistPatientIds) {
  if (waitlistPatientIds.size === 0) return visits;
  const matched = visits.filter((v) => waitlistPatientIds.has(String(v.patientId ?? '').trim()));
  return matched.length > 0 ? matched : visits;
}

const visits = [
  { appointmentId: 1, patientId: '10', patientName: 'A' },
  { appointmentId: 2, patientId: '20', patientName: 'B' },
];
const filtered = filterSameDayVisitsForWaitlistPets(visits, new Set(['20']));
assert(filtered.length === 1 && filtered[0].patientId === '20', 'filters to waitlist pets');
assert(
  filterSameDayVisitsForWaitlistPets(visits, new Set(['99'])).length === 2,
  'falls back to full day when no waitlist pet matches',
);

console.log('waitlistExploreAlternativesSmoke: ok');

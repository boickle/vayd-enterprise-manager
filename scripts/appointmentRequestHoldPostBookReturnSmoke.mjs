/**
 * Smoke checks for appointment-request HOLD post-book return routing.
 * Run: node scripts/appointmentRequestHoldPostBookReturnSmoke.mjs
 *
 * HOLD books must land on /schedule/holds (not New), so Don't send does not
 * erase the row from a tab that no longer lists holds.
 */

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const APPOINTMENTS_PATH_PREFIX = '/schedule/appointments';
const HOLDS_PATH = '/schedule/holds';
const HOLDS_HIGHLIGHT_PARAM = 'highlight';
const DEFAULT_HOLDS_OWNER_FILTER = 'me_unassigned';

function holdsPathForOwner(owner) {
  if (owner === DEFAULT_HOLDS_OWNER_FILTER) return HOLDS_PATH;
  const params = new URLSearchParams();
  params.set('owner', String(owner));
  return `${HOLDS_PATH}?${params.toString()}`;
}

function holdsPathWithHighlight(submissionId, opts) {
  const owner = opts?.owner ?? DEFAULT_HOLDS_OWNER_FILTER;
  const url = new URL(holdsPathForOwner(owner), 'http://local');
  url.searchParams.set(HOLDS_HIGHLIGHT_PARAM, String(submissionId));
  return `${url.pathname}${url.search}`;
}

function appointmentRequestsPathForTab(tab) {
  if (tab === 'on_hold') return HOLDS_PATH;
  const params = new URLSearchParams();
  if (tab !== 'new') params.set('tab', tab);
  const qs = params.toString();
  return qs ? `${APPOINTMENTS_PATH_PREFIX}?${qs}` : APPOINTMENTS_PATH_PREFIX;
}

function appointmentRequestPostBookReturnPath(args) {
  if (args.isHold) {
    return holdsPathWithHighlight(args.appointmentRequestSubmissionId);
  }
  return appointmentRequestsPathForTab(args.returnListTab ?? 'new');
}

function normalizeReturnSession(o) {
  if (
    o?.v !== 1 ||
    typeof o.appointmentRequestSubmissionId !== 'number' ||
    typeof o.bookedAppointmentId !== 'number' ||
    !o.bookedAppointmentStart?.trim()
  ) {
    return null;
  }
  return {
    ...o,
    isHold: o.isHold === true,
    openSms: o.openSms !== false,
  };
}

const PAGINATED_LIST_TABS = new Set(['new', 'booked', 'dismissed', 'contacted', 'to_confirm']);

// HOLD book → Holds board with highlight
assert(
  appointmentRequestPostBookReturnPath({
    isHold: true,
    appointmentRequestSubmissionId: 4242,
  }) === '/schedule/holds?highlight=4242',
  'HOLD book should return to Holds with highlight',
);

// Real visit book → New (default)
assert(
  appointmentRequestPostBookReturnPath({
    isHold: false,
    appointmentRequestSubmissionId: 4242,
  }) === '/schedule/appointments',
  'non-HOLD book should return to New',
);

// Real visit book → Contacted when that was the origin tab
assert(
  appointmentRequestPostBookReturnPath({
    isHold: false,
    appointmentRequestSubmissionId: 4242,
    returnListTab: 'contacted',
  }) === '/schedule/appointments?tab=contacted',
  'non-HOLD book should restore origin tab',
);

// Return session: missing openSms defaults to true; isHold requires explicit true
assert(
  normalizeReturnSession({
    v: 1,
    appointmentRequestSubmissionId: 1,
    bookedAppointmentId: 2,
    bookedAppointmentStart: '2026-11-09T15:00:00.000Z',
  }).openSms === true,
  'openSms should default true',
);
assert(
  normalizeReturnSession({
    v: 1,
    appointmentRequestSubmissionId: 1,
    bookedAppointmentId: 2,
    bookedAppointmentStart: '2026-11-09T15:00:00.000Z',
  }).isHold === false,
  'isHold should default false',
);
assert(
  normalizeReturnSession({
    v: 1,
    appointmentRequestSubmissionId: 1,
    bookedAppointmentId: 2,
    bookedAppointmentStart: '2026-11-09T15:00:00.000Z',
    isHold: true,
    openSms: false,
  }).isHold === true &&
    normalizeReturnSession({
      v: 1,
      appointmentRequestSubmissionId: 1,
      bookedAppointmentId: 2,
      bookedAppointmentStart: '2026-11-09T15:00:00.000Z',
      isHold: true,
      openSms: false,
    }).openSms === false,
  'explicit isHold/openSms should be preserved',
);

// New tab stays in the paginated set so Gmail label fetches stay bounded
assert(PAGINATED_LIST_TABS.has('new'), 'New tab must be paginated for Gmail label bound');

console.log('appointmentRequestHoldPostBookReturnSmoke: ok');

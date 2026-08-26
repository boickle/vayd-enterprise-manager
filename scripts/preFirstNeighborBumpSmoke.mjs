/**
 * Smoke checks for PRE-FIRST neighbor bump eligibility (no test runner in repo).
 * Run: node scripts/preFirstNeighborBumpSmoke.mjs
 *
 * Mirrors the pure filters in src/utils/preFirstNeighborBump.ts so we can
 * assert meetings/blocks are never selected as former-first without a bundler.
 */

function isFixedTimeTypeName(name) {
  const lower = String(name || '')
    .trim()
    .toLowerCase();
  return lower === 'fixed time' || lower.includes('fixed time');
}

function isPracticeCalendarBlockAppointment(a) {
  if (a?.type === 'block' || a?.isBlock === true || a?.isPersonalBlock === true) return true;
  const at = a?.appointmentType;
  const typeBlob = `${at?.prettyName ?? ''} ${at?.name ?? ''}`.trim().toLowerCase();
  if (
    typeBlob === 'block' ||
    typeBlob.includes('personal block') ||
    typeBlob.includes('flex block') ||
    /^block[\s/]/i.test(typeBlob)
  ) {
    return true;
  }
  return false;
}

function isNonRoutableStaffCalendarTypeName(name) {
  const lower = String(name || '')
    .trim()
    .toLowerCase();
  if (!lower) return false;
  if (lower === 'meeting' || lower.includes('meeting')) return true;
  if (lower.includes('note to staff')) return true;
  if (lower === 'vacation' || lower === 'sick time') return true;
  return false;
}

function appointmentTypeName(a) {
  return String(a?.appointmentType?.name || a?.appointmentType?.prettyName || '').trim();
}

function isPreFirstNeighborBumpEligibleAppointment(a) {
  if (a?.isDeleted === true) return false;
  if (a?.isActive === false) return false;
  if (a?.allDay) return false;
  if (!a?.appointmentStart?.trim() || !a?.appointmentEnd?.trim()) return false;
  if (isPracticeCalendarBlockAppointment(a)) return false;
  if (isFixedTimeTypeName(appointmentTypeName(a))) return false;
  if (isNonRoutableStaffCalendarTypeName(appointmentTypeName(a))) return false;
  if (a?.appointmentType?.excludeFromRouting === true) return false;
  if (a?.client?.id == null) return false;
  return true;
}

function findFormerFirst(appointments) {
  return (
    appointments
      .filter((a) => isPreFirstNeighborBumpEligibleAppointment(a))
      .sort(
        (a, b) =>
          Date.parse(a.appointmentStart) - Date.parse(b.appointmentStart) ||
          Number(a.id) - Number(b.id)
      )[0] ?? null
  );
}

const day = '2026-08-12';
const meeting = {
  id: 100,
  appointmentStart: `${day}T15:50:00.000Z`, // 11:50 AM ET
  appointmentEnd: `${day}T16:30:00.000Z`,
  appointmentType: { name: 'Meeting', prettyName: 'Meeting' },
  // no client — doc meeting
};
const block = {
  id: 101,
  appointmentStart: `${day}T14:00:00.000Z`,
  appointmentEnd: `${day}T14:30:00.000Z`,
  type: 'block',
  isBlock: true,
  isPersonalBlock: true,
  appointmentType: { name: 'Block' },
};
const clientVisit = {
  id: 200,
  appointmentStart: `${day}T17:00:00.000Z`, // later than meeting
  appointmentEnd: `${day}T18:00:00.000Z`,
  appointmentType: { name: 'HOLD', prettyName: 'HOLD' },
  client: { id: 55 },
};
const earlierClient = {
  id: 199,
  appointmentStart: `${day}T13:00:00.000Z`,
  appointmentEnd: `${day}T14:00:00.000Z`,
  appointmentType: { name: 'Standard', prettyName: 'Standard' },
  client: { id: 77 },
};

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed += 1;
  } else {
    console.log('ok:', msg);
  }
}

assert(!isPreFirstNeighborBumpEligibleAppointment(meeting), 'Meeting is not bump-eligible');
assert(!isPreFirstNeighborBumpEligibleAppointment(block), 'Personal block is not bump-eligible');
assert(isPreFirstNeighborBumpEligibleAppointment(clientVisit), 'Client visit is bump-eligible');

const formerWhenMeetingFirst = findFormerFirst([meeting, clientVisit]);
assert(
  formerWhenMeetingFirst?.id === 200,
  'Skips earlier Meeting and picks first client visit'
);

const formerWithEarlierClient = findFormerFirst([meeting, earlierClient, clientVisit]);
assert(
  formerWithEarlierClient?.id === 199,
  'Picks earliest client visit, not Meeting'
);

const onlyMeeting = findFormerFirst([meeting, block]);
assert(onlyMeeting == null, 'No bump target when day only has Meeting/block');

if (failed) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log('\nAll smoke checks passed');

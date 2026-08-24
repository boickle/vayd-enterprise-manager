/**
 * Smoke checks: Auto-Booked rows must show Confirm (not Book / Link) before
 * bookedApptMeta hydrates. Run: node scripts/appointmentRequestAutoBookActionsSmoke.mjs
 *
 * Mirrors src/utils/appointmentRequestStaffConfirm.ts.
 */

function requestDataSelfScheduledSlot(rd) {
  const raw = rd?.selfScheduledSlot;
  if (!raw || typeof raw !== 'object') return null;
  const appointmentStart =
    typeof raw.appointmentStart === 'string' ? raw.appointmentStart.trim() : '';
  return appointmentStart ? raw : null;
}

function appointmentRequestAutoBookedOnline(item) {
  const rd = item.requestData ?? {};
  return (
    (item.status ?? 'new') === 'booked' &&
    item.bookedAppointmentId != null &&
    !!item.bookedAt &&
    requestDataSelfScheduledSlot(rd) != null
  );
}

function appointmentRequestNeedsStaffConfirmation(item) {
  return appointmentRequestAutoBookedOnline(item) && !item.staffConfirmedAt?.trim();
}

function appointmentRequestNeedsManualBookActions(args) {
  if (appointmentRequestNeedsStaffConfirmation(args.item)) return false;
  return !args.isDismissed && !args.isBooked && !args.hasLinkedAppointment;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const pendingAutoBook = {
  status: 'booked',
  bookedAppointmentId: 99101,
  bookedAt: '2026-08-18T06:36:00.000Z',
  staffConfirmedAt: null,
  requestData: {
    selfScheduledSlot: { appointmentStart: '2026-08-18T14:40:00.000Z' },
  },
};

const confirmedAutoBook = {
  ...pendingAutoBook,
  staffConfirmedAt: '2026-08-18T15:00:00.000Z',
};

const ordinaryNew = {
  status: 'new',
  bookedAppointmentId: null,
  bookedAt: null,
  staffConfirmedAt: null,
  requestData: {},
};

// Before calendar meta hydrates: hasLinkedAppointment is false.
assert(
  appointmentRequestNeedsStaffConfirmation(pendingAutoBook) === true,
  'pending auto-book needs staff confirmation from submission fields',
);
assert(
  appointmentRequestNeedsManualBookActions({
    item: pendingAutoBook,
    isDismissed: false,
    isBooked: false,
    hasLinkedAppointment: false,
  }) === false,
  'pending auto-book must not show Book/Link while meta is missing',
);

// After meta hydrates with an active linked visit.
assert(
  appointmentRequestNeedsManualBookActions({
    item: pendingAutoBook,
    isDismissed: false,
    isBooked: false,
    hasLinkedAppointment: true,
  }) === false,
  'pending auto-book still prefers Confirm after meta loads',
);

// Staff-confirmed auto-book is no longer in the Confirm queue.
assert(
  appointmentRequestNeedsStaffConfirmation(confirmedAutoBook) === false,
  'confirmed auto-book is not pending Confirm',
);

// Ordinary unscheduled request still gets Book / Link.
assert(
  appointmentRequestNeedsManualBookActions({
    item: ordinaryNew,
    isDismissed: false,
    isBooked: false,
    hasLinkedAppointment: false,
  }) === true,
  'ordinary new request still needs manual book actions',
);

assert(
  appointmentRequestNeedsManualBookActions({
    item: ordinaryNew,
    isDismissed: false,
    isBooked: true,
    hasLinkedAppointment: true,
  }) === false,
  'already-booked request does not need manual book actions',
);

console.log('appointmentRequestAutoBookActionsSmoke: ok');

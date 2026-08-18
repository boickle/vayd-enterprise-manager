/**
 * Smoke checks: Auto-Booked rows show Confirm immediately (not Book / Link).
 * Run: node scripts/appointmentRequestAutoBookConfirmActionsSmoke.mjs
 *
 * Mirrors helpers in src/utils/appointmentRequestStaffConfirm.ts so hydration
 * lag of bookedApptMeta cannot flash the wrong primary CTA.
 */

function requestDataSelfScheduledSlot(rd) {
  const raw = rd?.selfScheduledSlot;
  if (!raw || typeof raw !== 'object') return null;
  const appointmentStart =
    typeof raw.appointmentStart === 'string' ? raw.appointmentStart.trim() : '';
  if (!appointmentStart) return null;
  return { appointmentStart, ...raw };
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

function appointmentRequestShouldShowConfirmAction(item) {
  return appointmentRequestNeedsStaffConfirmation(item);
}

function appointmentRequestNeedsManualBookActions(args) {
  if (args.isDismissed || args.isBooked || args.hasLinkedAppointment) return false;
  if (appointmentRequestShouldShowConfirmAction(args.item)) return false;
  return true;
}

function appointmentRequestShowsLinkedVisitActions(args) {
  return (
    args.isBooked ||
    args.hasLinkedAppointment ||
    appointmentRequestShouldShowConfirmAction(args.item)
  );
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const autoBookedPending = {
  id: 101,
  status: 'booked',
  bookedAppointmentId: 555,
  bookedAt: '2026-08-18T06:36:00.000Z',
  staffConfirmedAt: null,
  requestData: {
    selfScheduledSlot: {
      appointmentStart: '2026-08-18T14:40:00.000Z',
      appointmentEnd: '2026-08-18T16:40:00.000Z',
      display: 'Standard - Tue, August 18 2026',
    },
  },
};

// Before bookedApptMeta hydrates: hasLinkedAppointment is false.
assert(
  appointmentRequestShouldShowConfirmAction(autoBookedPending),
  'auto-booked pending confirm should show Confirm from submission fields alone',
);
assert(
  !appointmentRequestNeedsManualBookActions({
    item: autoBookedPending,
    isDismissed: false,
    isBooked: false,
    hasLinkedAppointment: false,
  }),
  'must not show Book / Link appointment while meta is still loading',
);
assert(
  appointmentRequestShowsLinkedVisitActions({
    item: autoBookedPending,
    isBooked: false,
    hasLinkedAppointment: false,
  }),
  'must still enter the Confirm action cluster before meta hydrates',
);

// After meta hydrates: still Confirm.
assert(
  appointmentRequestShouldShowConfirmAction(autoBookedPending),
  'still Confirm after hasLinkedAppointment becomes true',
);
assert(
  !appointmentRequestNeedsManualBookActions({
    item: autoBookedPending,
    isDismissed: false,
    isBooked: false,
    hasLinkedAppointment: true,
  }),
  'still not manual book after meta hydrates',
);

const staffConfirmed = {
  ...autoBookedPending,
  staffConfirmedAt: '2026-08-18T12:00:00.000Z',
};
assert(
  !appointmentRequestShouldShowConfirmAction(staffConfirmed),
  'staff-confirmed auto-book should not show Confirm',
);
assert(
  appointmentRequestShowsLinkedVisitActions({
    item: staffConfirmed,
    isBooked: true,
    hasLinkedAppointment: true,
  }),
  'staff-confirmed linked visit still uses linked actions',
);

const ordinaryNew = {
  id: 202,
  status: 'new',
  bookedAppointmentId: null,
  bookedAt: null,
  requestData: {},
};
assert(
  appointmentRequestNeedsManualBookActions({
    item: ordinaryNew,
    isDismissed: false,
    isBooked: false,
    hasLinkedAppointment: false,
  }),
  'ordinary new requests still get Book / Link',
);
assert(
  !appointmentRequestShouldShowConfirmAction(ordinaryNew),
  'ordinary new requests do not get Confirm',
);

console.log('appointmentRequestAutoBookConfirmActionsSmoke: ok');

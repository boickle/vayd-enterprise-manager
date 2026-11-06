import { isForwardBookingTask, LABS_PENDING_FORWARD_BOOKING_TASK_BODY } from './forwardBookingCreateLink';

const links = [
  { entityType: 'client', entityId: 1 },
  { entityType: 'appointment', entityId: 2 },
  { entityType: 'patient', entityId: 3 },
];

describe('isForwardBookingTask', () => {
  it('recognizes labs tasks with the new wording and the wording used before Schedule follow-ups', () => {
    expect(isForwardBookingTask({ body: LABS_PENDING_FORWARD_BOOKING_TASK_BODY, links })).toBe(true);
    expect(
      isForwardBookingTask({ body: 'When lab results are back, add to the forward booking list.', links })
    ).toBe(true);
  });
  it('ignores other tasks that happen to link a patient and visit', () => {
    expect(isForwardBookingTask({ body: 'Call about the invoice', links })).toBe(false);
  });
});

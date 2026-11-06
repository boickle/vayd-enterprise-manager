import { describe, expect, it } from 'vitest';
import { appointmentFormSubmitSuccessKindFromResponse as kind } from './onlineBooking';

const HELD =
  "We've held your appointment. Please check your email for details — we'll confirm once we review your pet's records.";

describe('appointment form success screen', () => {
  it('shows the held screen for a visit held for handling review, even though it is booked', () => {
    expect(kind({ bookingOutcome: 'booked', message: HELD })).toBe('online_held_pending_handling');
    expect(kind({ bookingOutcome: 'partial', message: HELD })).toBe('online_held_pending_handling');
    expect(kind({ message: HELD })).toBe('online_held_pending_handling');
  });

  it('keeps the booked, partial, slot-taken and request screens', () => {
    expect(kind({ bookingOutcome: 'booked', message: 'Your appointment has been booked successfully.' })).toBe(
      'online_confirmed'
    );
    expect(kind({ bookingOutcome: 'partial', message: 'Booked for Max.' })).toBe('online_partial');
    expect(kind({ bookingOutcome: 'slot_taken', message: 'That time was just taken.' })).toBe('slot_taken');
    expect(kind({ bookingOutcome: 'request', message: 'Submitted.' })).toBe('request_received');
  });
});

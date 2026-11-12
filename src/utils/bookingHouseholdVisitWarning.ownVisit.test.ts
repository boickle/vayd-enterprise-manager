import { describe, expect, it } from 'vitest';
import { slotOverlapsBookedPetVisit, type HouseholdScheduledVisitConflict } from './bookingHouseholdVisitWarning';

/** B5 (training review, Nov 7, 2026): Biscuit was offered 10:50, on top of his own 11:00 recheck. */
const biscuit11: HouseholdScheduledVisitConflict = {
  appointmentId: 1,
  patientNames: ['Biscuit'],
  patientIds: ['8581'],
  scheduledLabel: 'Mon 11:00',
  appointmentTypeLabel: 'Recheck',
  isHold: false,
  notes: null,
  appointmentStartIso: '2026-11-09T16:00:00.000Z',
  appointmentEndIso: '2026-11-09T16:45:00.000Z',
  practiceDateKey: '2026-11-09',
  primaryProviderId: null,
};

describe('slotOverlapsBookedPetVisit', () => {
  it('hides a slot that overlaps the pet’s own visit', () => {
    expect(slotOverlapsBookedPetVisit('2026-11-09T15:50:00.000Z', 45, ['8581'], [biscuit11])).toBe(true);
  });
  it('keeps a slot that ends before the visit starts', () => {
    expect(slotOverlapsBookedPetVisit('2026-11-09T15:00:00.000Z', 45, ['8581'], [biscuit11])).toBe(false);
  });
  it('keeps a slot next to a housemate’s visit (another pet can join the stop)', () => {
    expect(slotOverlapsBookedPetVisit('2026-11-09T15:50:00.000Z', 45, ['8578'], [biscuit11])).toBe(false);
  });
  it('does nothing when no pet is picked', () => {
    expect(slotOverlapsBookedPetVisit('2026-11-09T15:50:00.000Z', 45, [], [biscuit11])).toBe(false);
  });
});

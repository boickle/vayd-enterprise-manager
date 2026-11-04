import { beforeEach, describe, expect, it } from 'vitest';
import type { ForwardBookingEntry } from '../api/forwardBooking';
import {
  buildRoutingForwardBookingIntentFromEntries,
  readRoutingForwardBookingIntent,
  writeRoutingForwardBookingIntent,
} from './routingForwardBookingIntent';

const row = (id: number, patientId: number, typeId: number, premeds: boolean) =>
  ({
    id,
    trackingToken: `t${id}`,
    patientId,
    patient: { name: `Pet ${patientId}` },
    client: { id: 50, firstName: 'Ada', lastName: 'Okafor' },
    intervalAmount: 12,
    intervalUnit: 'months',
    appointmentTypeId: typeId,
    appointmentTypeName: `Type ${typeId}`,
    needsPremeds: premeds,
    serviceMinutes: 40,
  }) as unknown as ForwardBookingEntry;

/** Write a two-pet household intent from the given origin and read it back. */
function roundTrip(origin: 'follow_up_planner' | 'care_outreach') {
  const rows = [row(1, 11, 4, false), row(2, 12, 6, true)];
  const intent = buildRoutingForwardBookingIntentFromEntries(rows[0], rows)!;
  writeRoutingForwardBookingIntent({ ...intent, origin, householdScope: 'household_same_target' });
  return readRoutingForwardBookingIntent()!.householdEntries!;
}

describe('routing forward-booking intent: household entries', () => {
  beforeEach(() => sessionStorage.clear());

  it('keeps each pet’s type and pre-meds for Schedule follow-ups', () => {
    const entries = roundTrip('follow_up_planner');
    expect(entries.map((e) => [e.patientId, e.appointmentTypeId, e.needsPremeds === true])).toEqual(
      [
        ['11', 4, false],
        ['12', 6, true],
      ]
    );
  });

  it('drops the row type for other lists but keeps pre-meds per pet', () => {
    const entries = roundTrip('care_outreach');
    expect(entries.map((e) => [e.appointmentTypeId, e.needsPremeds === true])).toEqual([
      [undefined, false],
      [undefined, true],
    ]);
  });
});

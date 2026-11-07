import { describe, expect, it } from 'vitest';
import type { Appointment } from '../api/roomLoader';
import { collectSameDayHouseholdVisits, rescheduleScopeTargets } from './routingRescheduleIntent';

const TZ = 'America/New_York';
const client = { id: 7490, firstName: 'Maria', lastName: 'Rivera' };
const maple = { id: 8578, name: 'Maple', isActive: true };
const juniper = { id: 8579, name: 'Juniper', isActive: true };

function visit(id: number, pet: typeof maple, startIso: string, endIso: string, type: string): Appointment {
  return {
    id,
    appointmentStart: startIso,
    appointmentEnd: endIso,
    client,
    patient: pet,
    appointmentType: { id: 473, name: type, prettyName: type },
    isDeleted: false,
  } as unknown as Appointment;
}

// Monday Nov 9, 2026 (Eastern): Maple 9:00 and 3:00, Juniper 1:30.
const maple9 = visit(1, maple, '2026-11-09T14:00:00.000Z', '2026-11-09T15:00:00.000Z', 'Medical Visit');
const juniper130 = visit(2, juniper, '2026-11-09T18:30:00.000Z', '2026-11-09T19:30:00.000Z', 'Wellness');
const maple3 = visit(3, maple, '2026-11-09T20:00:00.000Z', '2026-11-09T20:30:00.000Z', 'Recheck');
const day = [maple9, juniper130, maple3];

describe('collectSameDayHouseholdVisits (training review B1, Nov 7, 2026)', () => {
  it('keeps the right-clicked visit for its pet when that pet has two visits that day', () => {
    const visits = collectSameDayHouseholdVisits(maple3, day, TZ);
    const mapleRow = visits.find((v) => v.patientId === String(maple.id));
    expect(mapleRow?.appointmentId).toBe(3);
  });

  it('still lists the other pets in the household that day', () => {
    const visits = collectSameDayHouseholdVisits(maple3, day, TZ);
    expect(visits.map((v) => v.appointmentId).sort()).toEqual([2, 3]);
  });

  it('"Only this pet" targets just the right-clicked visit', () => {
    const sameDayVisits = collectSameDayHouseholdVisits(maple3, day, TZ);
    const targets = rescheduleScopeTargets({
      v: 1,
      appointmentId: 3,
      clientId: '7490',
      patientId: String(maple.id),
      sameDayVisits,
      rescheduleScope: 'selected_pet',
    } as never);
    expect(targets.appointmentIds).toEqual([3]);
  });
});

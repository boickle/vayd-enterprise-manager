import { beforeEach, describe, expect, it, vi } from 'vitest';

const createAppointment = vi.hoisted(() => vi.fn());
vi.mock('../api/appointments', async (orig) => ({
  ...(await orig<typeof import('../api/appointments')>()),
  createAppointment,
}));

import {
  createRoutingBookVisits,
  forwardBookingBookPrefillFromIntent,
  routingBookCreatePayload,
  type RoutingBookSlot,
} from './routingBookVisits';
import type { RoutingForwardBookingIntentV1 } from './routingForwardBookingIntent';

const slot: RoutingBookSlot = {
  practiceId: 1,
  primaryProviderId: 7,
  clientId: 50,
  appointmentStart: '2027-11-02T14:00:00.000Z',
  appointmentEnd: '2027-11-02T14:50:00.000Z',
  bookedViaRouting: true,
};

beforeEach(() => createAppointment.mockReset());

describe('routingBookCreatePayload', () => {
  it('is the Book modal’s per-pet routing body', () => {
    expect(
      routingBookCreatePayload(slot, {
        patientId: ' 3 ',
        appointmentTypeId: '2',
        description: '  annual exam ',
        instructions: '',
        needsPremeds: true,
      })
    ).toEqual({
      practiceId: 1,
      primaryProviderId: 7,
      clientId: 50,
      patientId: 3,
      appointmentTypeId: 2,
      appointmentStart: '2027-11-02T14:00:00.000Z',
      appointmentEnd: '2027-11-02T14:50:00.000Z',
      description: 'annual exam',
      instructions: undefined,
      needsPremeds: true,
      bookedViaRouting: true,
    });
  });

  it('carries the optional parts only when given', () => {
    const body = routingBookCreatePayload(
      {
        ...slot,
        clientId: null,
        bookedViaRouting: false,
        additionalEmployeeIds: [9],
        alternateAddressText: '12 Shore Rd',
        allDay: true,
        extras: { forwardBookingTrackingToken: 'tok', joinWaitlistIfSooner: true },
      },
      {
        patientId: null,
        appointmentTypeId: 4,
        description: '',
        instructions: 'gate code 1234',
        needsPremeds: false,
      }
    );
    expect(body).toEqual({
      practiceId: 1,
      primaryProviderId: 7,
      additionalEmployeeIds: [9],
      alternateAddressText: '12 Shore Rd',
      appointmentTypeId: 4,
      appointmentStart: slot.appointmentStart,
      appointmentEnd: slot.appointmentEnd,
      allDay: true,
      description: undefined,
      instructions: 'gate code 1234',
      needsPremeds: false,
      forwardBookingTrackingToken: 'tok',
      joinWaitlistIfSooner: true,
    });
    expect(body).not.toHaveProperty('clientId');
    expect(body).not.toHaveProperty('patientId');
    expect(body).not.toHaveProperty('bookedViaRouting');
  });
});

describe('createRoutingBookVisits', () => {
  it('creates one appointment per visit in order and runs afterCreate for each', async () => {
    let id = 100;
    createAppointment.mockImplementation(async () => ({ id: ++id }));
    const after = vi.fn(async () => undefined);
    const res = await createRoutingBookVisits(
      slot,
      [
        {
          patientId: '3',
          appointmentTypeId: 2,
          description: 'a',
          instructions: '',
          needsPremeds: false,
        },
        {
          patientId: null,
          appointmentTypeId: 5,
          description: 'b',
          instructions: '',
          needsPremeds: false,
        },
      ],
      after
    );
    expect(createAppointment).toHaveBeenCalledTimes(2);
    expect(res.firstAppointmentId).toBe(101);
    expect(res.appointmentIds).toEqual([101, 102]);
    expect([...res.createdByPatientId]).toEqual([['3', 101]]);
    expect(after.mock.calls.map((c) => c[0])).toEqual([101, 102]);
  });
});

describe('forwardBookingBookPrefillFromIntent', () => {
  const intent = {
    v: 1,
    forwardBookingId: 500,
    trackingToken: 'tok-500',
    clientId: '50',
    patientId: '3',
  } as RoutingForwardBookingIntentV1;

  it('one pet: the row and its token', () => {
    expect(
      forwardBookingBookPrefillFromIntent(intent, {
        entries: [{ forwardBookingId: 500, trackingToken: 'tok-500', patientId: '3' }],
      })
    ).toEqual({ forwardBookingTrackingToken: 'tok-500', forwardBookingEntryId: 500 });
  });

  it('a household: each pet’s row with its own notes, type and pre-meds', () => {
    expect(
      forwardBookingBookPrefillFromIntent(intent, {
        entries: [
          {
            forwardBookingId: 500,
            trackingToken: 'tok-500',
            patientId: '3',
            patientName: 'Marvin',
            bookingNotes: 'ear recheck',
            appointmentTypeId: 2,
          },
          {
            forwardBookingId: 501,
            trackingToken: 'tok-501',
            patientId: '4',
            patientName: 'Biscuit',
            description: 'annual',
            needsPremeds: true,
          },
        ],
      }).forwardBookingVisitCompletes
    ).toEqual([
      {
        forwardBookingEntryId: 500,
        forwardBookingTrackingToken: 'tok-500',
        patientId: '3',
        patientName: 'Marvin',
        description: 'ear recheck',
        appointmentTypeId: 2,
        needsPremeds: false,
      },
      {
        forwardBookingEntryId: 501,
        forwardBookingTrackingToken: 'tok-501',
        patientId: '4',
        patientName: 'Biscuit',
        description: 'annual',
        needsPremeds: true,
      },
    ]);
  });
});

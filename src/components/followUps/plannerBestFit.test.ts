import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  get: vi.fn(),
  fetchClientByIdStaff: vi.fn(),
  fetchPrimaryProviders: vi.fn(),
  fetchVeterinariansForDoctorSelect: vi.fn(),
  doctorPimsIdsAcceptingAppointmentType: vi.fn(),
  createAppointment: vi.fn(),
  patchAppointment: vi.fn(),
  fetchAppointmentsRangeForLocalDay: vi.fn(),
  completeForwardBooking: vi.fn(),
  submitRoutingFeedback: vi.fn(),
}));

vi.mock('../../api/http', async (orig) => ({
  ...(await orig<typeof import('../../api/http')>()),
  http: { post: mocks.post, get: mocks.get },
}));
vi.mock('../../api/clientsStaff', () => ({ fetchClientByIdStaff: mocks.fetchClientByIdStaff }));
vi.mock('../../api/employee', () => ({ fetchPrimaryProviders: mocks.fetchPrimaryProviders }));
vi.mock('../../utils/veterinarianZoneLookup', () => ({
  fetchVeterinariansForDoctorSelect: mocks.fetchVeterinariansForDoctorSelect,
  doctorPimsIdsAcceptingAppointmentType: mocks.doctorPimsIdsAcceptingAppointmentType,
}));
vi.mock('../../api/appointments', async (orig) => ({
  ...(await orig<typeof import('../../api/appointments')>()),
  createAppointment: mocks.createAppointment,
  patchAppointment: mocks.patchAppointment,
  fetchAppointmentsRangeForLocalDay: mocks.fetchAppointmentsRangeForLocalDay,
}));
vi.mock('../../api/forwardBooking', async (orig) => ({
  ...(await orig<typeof import('../../api/forwardBooking')>()),
  completeForwardBooking: mocks.completeForwardBooking,
}));
vi.mock('../../api/routingFeedback', () => ({
  submitRoutingFeedback: mocks.submitRoutingFeedback,
}));

import {
  bestFitPreviewPayload,
  bestFitQualities,
  bestFitReason,
  bestFitSlotsFromResult,
  bookBestFitSlot,
  buildBestFitRoutingBody,
  searchPlannerBestFit,
  type BestFitRequest,
  type BestFitSlot,
} from './plannerBestFit';
import type { RoutingForwardBookingIntentV1 } from '../../utils/routingForwardBookingIntent';

const TZ = 'America/New_York';
const req: BestFitRequest = {
  clientId: 50,
  clientLabel: 'Ada Okafor',
  providerId: 7,
  doctorPimsId: null,
  providerName: 'Priya Patel',
  appointmentTypeId: 2,
  statsTypeKey: 'Recheck',
  typeLabel: 'Recheck',
  serviceMinutes: 25,
  needsPremeds: false,
  pets: [{ id: 3, name: 'Marvin' }],
  window: { startDate: '2099-11-09', endDate: '2099-11-23' },
};
const place = { address: '1 Elm St, Portland, ME 04101', lat: 43.66, lon: -70.25 };

beforeEach(() => {
  Object.values(mocks).forEach((m) => m.mockReset());
  mocks.fetchPrimaryProviders.mockResolvedValue([{ id: 7, pimsId: 'P7', name: 'Priya Patel' }]);
  mocks.fetchClientByIdStaff.mockResolvedValue({
    id: 50,
    address1: '1 Elm St',
    city: 'Portland',
    state: 'ME',
    zip: '04101',
    lat: 43.66,
    lon: -70.25,
  });
  mocks.doctorPimsIdsAcceptingAppointmentType.mockResolvedValue(new Set(['P7']));
});

describe('buildBestFitRoutingBody', () => {
  it('sends Get Best Route’s single-doctor body with its defaults', () => {
    expect(
      buildBestFitRoutingBody({ req, place, tz: TZ, asap: false, doctorPimsId: 'P7' })
    ).toEqual({
      doctorId: 'P7',
      startDate: '2099-11-09',
      endDate: '2099-11-23',
      numDays: 15,
      newAppt: {
        serviceMinutes: 25,
        lat: 43.66,
        lon: -70.25,
        address: place.address,
        clientId: '50',
        appointmentTypeId: 2,
      },
      useTraffic: false,
      ignoreEmergencyBlocks: false,
      preferredWeekday: null,
      preferredTimeOfDay: null,
      preferEdge: null,
    });
  });

  it('ASAP: zone doctors, use reserve, 20 min added-drive cap; pre-meds carry the practice', () => {
    const body = buildBestFitRoutingBody({
      req: { ...req, needsPremeds: true },
      place,
      tz: TZ,
      asap: true,
      doctorPimsId: 'P7',
      asapDoctorIds: ['P7', 'P9'],
      practiceId: 1,
    });
    expect(body).toMatchObject({
      doctorIds: ['P7', 'P9'],
      ignoreEmergencyBlocks: true,
      maxAddedDriveMinutes: 20,
      newAppt: { needsPremeds: true, practiceId: 1 },
    });
    expect(body).not.toHaveProperty('doctorId');
  });

  it('sends the owner’s preferences as Get Best Route does', () => {
    const one = buildBestFitRoutingBody({
      req,
      place,
      tz: TZ,
      asap: false,
      doctorPimsId: 'P7',
      prefs: { weekdays: [2], timeOfDay: 'first', earliest: false },
    });
    expect(one).toMatchObject({ preferredWeekday: 2, preferredTimeOfDay: 'first' });
    expect(one).not.toHaveProperty('preferEarliestFeasibleStart');
    const many = buildBestFitRoutingBody({
      req,
      place,
      tz: TZ,
      asap: false,
      doctorPimsId: 'P7',
      prefs: { weekdays: [4, 1, 2], timeOfDay: 'end', earliest: true },
    });
    expect(many).toMatchObject({
      preferredWeekday: [1, 2, 4],
      preferredTimeOfDay: 'end',
      preferEarliestFeasibleStart: true,
    });
  });
});

describe('bestFitSlotsFromResult', () => {
  it('lists winner and alternates by score with doctor, window and drive', () => {
    const slots = bestFitSlotsFromResult(
      {
        routingRequestId: 'rr1',
        winner: {
          date: '2099-11-10',
          suggestedStartIso: '2099-11-10T15:00:00Z',
          insertionIndex: 1,
          score: 9,
          addedDriveSeconds: 600,
          arrivalWindow: {
            windowStartIso: '2099-11-10T14:00:00Z',
            windowEndIso: '2099-11-10T16:00:00Z',
          },
        },
        alternates: [
          {
            date: '2099-11-09',
            suggestedStartIso: '2099-11-09T15:00:00Z',
            insertionIndex: 0,
            score: 4,
            doctorId: 'P9',
            doctorName: 'Sam Nguyen',
          },
        ],
      } as never,
      { asap: false, requestedDoctorPimsId: 'P7', requestedDoctorName: 'Priya Patel' }
    );
    expect(slots.map((s) => [s.date, s.doctorName, s.score, s.isFallbackDoctor])).toEqual([
      ['2099-11-09', 'Sam Nguyen', 4, true],
      ['2099-11-10', 'Priya Patel', 9, false],
    ]);
    expect(slots[1]).toMatchObject({
      windowStartIso: '2099-11-10T14:00:00Z',
      addedDriveSeconds: 600,
      option: { routingRequestId: 'rr1', candidateIndex: 0, doctorPimsId: 'P7' },
    });
  });
});

describe('searchPlannerBestFit', () => {
  it('posts to /routing/v2 with the card’s doctor and returns the slots', async () => {
    mocks.post.mockResolvedValue({
      data: {
        winner: { date: '2099-11-10', suggestedStartIso: '2099-11-10T15:00:00Z', score: 3 },
      },
    });
    const res = await searchPlannerBestFit({ req, tz: TZ, asap: false });
    expect(res.error).toBeNull();
    expect(mocks.post).toHaveBeenCalledWith(
      '/routing/v2',
      expect.objectContaining({
        doctorId: 'P7',
        newAppt: expect.objectContaining({ clientId: '50' }),
      })
    );
    expect(res.slots).toHaveLength(1);
  });

  it('says so when routing is unavailable', async () => {
    mocks.post.mockResolvedValue({ data: { routingUnavailable: true } });
    const res = await searchPlannerBestFit({ req, tz: TZ, asap: false });
    expect(res.slots).toEqual([]);
    expect(res.error).toBeTruthy();
  });
});

const slotFrom = (winner: Record<string, unknown>) =>
  bestFitSlotsFromResult({ winner } as never, {
    asap: false,
    requestedDoctorPimsId: 'P7',
    requestedDoctorName: 'Priya Patel',
  })[0]!;

describe('bestFitPreviewPayload', () => {
  it('is Routing’s calendar preview for the slot, with the internal doctor id', () => {
    const slot = slotFrom({
      date: '2099-11-10',
      suggestedStartIso: '2099-11-10T15:00:00Z',
      insertionIndex: 2,
      routingRequestId: 'rr-1',
      candidateIndex: 1,
    });
    expect(bestFitPreviewPayload({ slot, req, place, internalDoctorId: '7' })).toMatchObject({
      version: 1,
      option: { doctorPimsId: '7', insertionIndex: 2, date: '2099-11-10' },
      serviceMinutes: 25,
      newApptMeta: { clientId: '50', address: place.address, lat: 43.66, lon: -70.25 },
      appointmentTypeId: 2,
      appointmentTypeChosenInRouting: true,
      routingStatsTypeKey: 'Recheck',
      previewPatients: [{ id: 3, name: 'Marvin' }],
      routingRequestId: 'rr-1',
      candidateIndex: 1,
    });
  });
});

describe('slot tags and reasons', () => {
  const base = slotFrom({ date: '2099-11-10', suggestedStartIso: '2099-11-10T15:00:00Z' });
  const s = (key: string, score: number | null, extra: Partial<BestFitSlot> = {}) =>
    ({ ...base, key, score, ...extra }) as BestFitSlot;

  it('tags the best score Best fit, close ones Great, the rest Good', () => {
    const q = bestFitQualities([s('a', 10), s('b', 12), s('c', 30), s('d', 10)]);
    expect([...q.values()]).toEqual(['Best fit', 'Great', 'Good', 'Great']);
  });

  it('says how full the day is and the extra drive', () => {
    expect(
      bestFitReason(s('a', 1, { dayVisitCount: 5, addedDriveSeconds: 360, zoneName: 'Eastside' }))
    ).toBe('Dr. Patel already has 5 visits in Eastside that day · 6 min extra drive');
    expect(bestFitReason(s('b', 1, { dayVisitCount: 1, addedDriveSeconds: 840 }))).toBe(
      'Light day for Dr. Patel · 14 min extra drive'
    );
    expect(bestFitReason(s('c', 1, { emptyDay: true, addedDriveSeconds: null }))).toBe(
      'Open day for Dr. Patel'
    );
  });
});

describe('bookBestFitSlot', () => {
  const intent: RoutingForwardBookingIntentV1 = {
    v: 1,
    forwardBookingId: 500,
    trackingToken: 'tok-500',
    clientId: '50',
    patientId: '3',
    householdScope: 'household_same_target',
    origin: 'follow_up_planner',
    householdEntries: [
      { forwardBookingId: 500, trackingToken: 'tok-500', patientId: '3', patientName: 'Marvin' },
      { forwardBookingId: 501, trackingToken: 'tok-501', patientId: '4', patientName: 'Biscuit' },
    ],
  } as RoutingForwardBookingIntentV1;

  beforeEach(() => {
    let id = 900;
    mocks.createAppointment.mockImplementation(async () => ({ id: ++id }));
    mocks.completeForwardBooking.mockResolvedValue({});
    mocks.submitRoutingFeedback.mockResolvedValue({});
    mocks.fetchAppointmentsRangeForLocalDay.mockResolvedValue([]);
  });

  it('books each pet at the slot as the calendar’s Book does and links their rows', async () => {
    const slot = slotFrom({
      date: '2099-11-10',
      suggestedStartIso: '2099-11-10T15:00:00Z',
      insertionIndex: 2,
      routingRequestId: 'rr-1',
      candidateIndex: 1,
    });
    const res = await bookBestFitSlot({
      practiceId: 1,
      slot,
      req: {
        ...req,
        pets: [
          { id: 3, name: 'Marvin' },
          { id: 4, name: 'Biscuit' },
        ],
      },
      place,
      tz: TZ,
      intent,
      visits: [
        { patientId: 3, appointmentTypeId: 2, description: ' ear recheck ', needsPremeds: false },
        { patientId: 4, appointmentTypeId: 1, description: 'annual exam', needsPremeds: true },
      ],
    });
    const body = {
      practiceId: 1,
      primaryProviderId: 7,
      clientId: 50,
      appointmentStart: '2099-11-10T15:00:00.000Z',
      appointmentEnd: '2099-11-10T15:25:00.000Z',
      bookedViaRouting: true,
    };
    expect(mocks.createAppointment.mock.calls.map((c) => c[0])).toEqual([
      {
        ...body,
        patientId: 3,
        appointmentTypeId: 2,
        description: 'ear recheck',
        needsPremeds: false,
      },
      {
        ...body,
        patientId: 4,
        appointmentTypeId: 1,
        description: 'annual exam',
        needsPremeds: true,
      },
    ]);
    expect(mocks.submitRoutingFeedback).toHaveBeenCalledWith({
      routingRequestId: 'rr-1',
      appointmentId: 901,
      candidateIndex: 1,
      selectionStatus: 'accepted',
    });
    expect(mocks.completeForwardBooking.mock.calls).toEqual([
      [500, { trackingToken: 'tok-500', appointmentId: 901, completedVia: 'routing' }],
      [501, { trackingToken: 'tok-501', appointmentId: 902, completedVia: 'routing' }],
    ]);
    // Not before the doctor's first visit: nobody else moves.
    expect(mocks.fetchAppointmentsRangeForLocalDay).not.toHaveBeenCalled();
    expect(mocks.patchAppointment).not.toHaveBeenCalled();
    expect(res).toEqual({
      appointmentIds: [901, 902],
      startIso: '2099-11-10T15:00:00.000Z',
      endIso: '2099-11-10T15:25:00.000Z',
      providerId: 7,
      warnings: [],
    });
  });

  it('before the first visit of the day, moves that visit to follow (as the calendar does)', async () => {
    mocks.fetchAppointmentsRangeForLocalDay.mockResolvedValue([
      {
        id: 77,
        appointmentStart: '2099-11-10T13:10:00Z',
        appointmentEnd: '2099-11-10T13:40:00Z',
        primaryProvider: { id: 7 },
        client: { id: 61 },
        isDeleted: false,
      },
    ]);
    const slot = slotFrom({
      date: '2099-11-10',
      suggestedStartIso: '2099-11-10T13:00:00Z',
      insertionIndex: 0,
    });
    await bookBestFitSlot({
      practiceId: 1,
      slot,
      req,
      place,
      tz: TZ,
      intent: { ...intent, householdScope: undefined, householdEntries: undefined },
      visits: [{ patientId: 3, appointmentTypeId: 2, description: 'recheck', needsPremeds: false }],
    });
    expect(mocks.fetchAppointmentsRangeForLocalDay).toHaveBeenCalledWith(
      expect.objectContaining({ dateIso: '2099-11-10', primaryProviderId: 7, practiceId: 1 })
    );
    // The former first visit (8:10) now starts once the new one ends (8:25).
    expect(mocks.patchAppointment).toHaveBeenCalledWith(
      77,
      expect.objectContaining({ bookedViaRouting: true }),
      { practiceId: 1 }
    );
    expect(mocks.patchAppointment.mock.calls[0][1]).toMatchObject({
      appointmentStart: '2099-11-10T13:25:00.000Z',
      appointmentEnd: '2099-11-10T13:55:00.000Z',
    });
    expect(mocks.completeForwardBooking).toHaveBeenCalledWith(500, {
      trackingToken: 'tok-500',
      appointmentId: 901,
      completedVia: 'routing',
    });
  });

  it('will not book a doctor it cannot find', async () => {
    mocks.fetchPrimaryProviders.mockResolvedValue([]);
    mocks.get.mockRejectedValue(new Error('404'));
    const slot = {
      ...slotFrom({ date: '2099-11-10', suggestedStartIso: '2099-11-10T15:00:00Z' }),
      doctorPimsId: 'P404',
    };
    await expect(
      bookBestFitSlot({
        practiceId: 1,
        slot,
        req,
        place,
        tz: TZ,
        intent: null,
        visits: [{ patientId: 3, appointmentTypeId: 2, description: 'x', needsPremeds: false }],
      })
    ).rejects.toThrow(/provider list/);
    expect(mocks.createAppointment).not.toHaveBeenCalled();
  });
});

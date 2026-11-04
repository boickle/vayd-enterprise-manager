import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  get: vi.fn(),
  fetchClientByIdStaff: vi.fn(),
  fetchPrimaryProviders: vi.fn(),
  fetchVeterinariansForDoctorSelect: vi.fn(),
  doctorPimsIdsAcceptingAppointmentType: vi.fn(),
  writeRoutingCalendarPreview: vi.fn(),
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
vi.mock('../../utils/routingCalendarPreviewStorage', async (orig) => ({
  ...(await orig<typeof import('../../utils/routingCalendarPreviewStorage')>()),
  writeRoutingCalendarPreview: mocks.writeRoutingCalendarPreview,
}));

import {
  bestFitSlotsFromResult,
  buildBestFitRoutingBody,
  searchPlannerBestFit,
  writeBestFitCalendarPreview,
  type BestFitRequest,
} from './plannerBestFit';

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

describe('writeBestFitCalendarPreview', () => {
  it('writes Routing’s calendar preview with the internal doctor id', async () => {
    const [slot] = bestFitSlotsFromResult(
      {
        winner: {
          date: '2099-11-10',
          suggestedStartIso: '2099-11-10T15:00:00Z',
          insertionIndex: 2,
        },
      } as never,
      { asap: false, requestedDoctorPimsId: 'P7', requestedDoctorName: 'Priya Patel' }
    );
    expect(await writeBestFitCalendarPreview({ slot: slot!, req, place })).toBe(true);
    expect(mocks.writeRoutingCalendarPreview).toHaveBeenCalledWith(
      expect.objectContaining({
        version: 1,
        option: expect.objectContaining({
          doctorPimsId: '7',
          insertionIndex: 2,
          date: '2099-11-10',
        }),
        serviceMinutes: 25,
        newApptMeta: { clientId: '50', address: place.address, lat: 43.66, lon: -70.25 },
        appointmentTypeId: 2,
        appointmentTypeChosenInRouting: true,
        routingStatsTypeKey: 'Recheck',
        previewPatients: [{ id: 3, name: 'Marvin' }],
      })
    );
  });
});

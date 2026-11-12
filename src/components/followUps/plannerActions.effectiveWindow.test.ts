import { describe, expect, it, vi } from 'vitest';
import { fetchAppointmentById } from '../../api/appointments';
import { fetchClientAppointmentsStaff } from '../../api/pimsAppointments';
import { bookingFromAppointments, findBookedAppointments } from './plannerActions';

vi.mock('../../api/appointments', async (orig) => ({
  ...((await orig()) as object),
  fetchAppointmentById: vi.fn(),
}));
vi.mock('../../api/pimsAppointments', async (orig) => ({
  ...((await orig()) as object),
  fetchClientAppointmentsStaff: vi.fn(),
}));

const TZ = 'America/New_York';
// Wed Nov 11, 2026, 8:00 AM New York = 13:00 UTC. The doctor starts at 8:00, so the effective
// arrival window is 8:00–10:00 (not 7:00–9:00, one hour either side of the start).
const START = '2026-11-11T13:00:00.000Z';
const row = (id: number, patientId: number) =>
  ({
    id,
    appointmentStart: START,
    appointmentEnd: '2026-11-11T14:00:00.000Z',
    patient: { id: patientId, name: `Pet ${patientId}` },
    appointmentType: { id: 3, name: 'Recheck', arrivalWindowBeforeMinutes: 60, arrivalWindowAfterMinutes: 60 },
  }) as never;

describe('booked follow-up arrival window', () => {
  it('uses the visit’s effective window, not one hour either side of the start', async () => {
    // The client's visit list has no window on its rows; the single visit has the effective one.
    vi.mocked(fetchClientAppointmentsStaff).mockResolvedValue([row(901, 11), row(902, 12)]);
    vi.mocked(fetchAppointmentById).mockResolvedValue({
      id: 901,
      appointmentStart: START,
      effectiveWindow: { startIso: '2026-11-11T13:00:00.000Z', endIso: '2026-11-11T15:00:00.000Z' },
    } as never);

    const rows = await findBookedAppointments({
      practiceId: 1,
      clientId: 50,
      startIso: START,
      petIds: [11, 12],
      tz: TZ,
    });
    const b = bookingFromAppointments(rows, { tz: TZ, provider: null, entryIds: [], fallbackStartIso: START });
    expect([b.windowStart.toFormat('h:mm a'), b.windowEnd.toFormat('h:mm a')]).toEqual(['8:00 AM', '10:00 AM']);
  });
});

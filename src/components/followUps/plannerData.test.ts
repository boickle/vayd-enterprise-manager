import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  fetchClientByIdStaff: vi.fn(),
  fetchClientAppointmentsStaff: vi.fn(),
  listPatientOpenReminders: vi.fn(),
}));
vi.mock('../../api/clientsStaff', () => ({ fetchClientByIdStaff: m.fetchClientByIdStaff }));
vi.mock('../../api/pimsAppointments', async (orig) => ({
  ...(await orig<typeof import('../../api/pimsAppointments')>()),
  fetchClientAppointmentsStaff: m.fetchClientAppointmentsStaff,
}));
vi.mock('../../api/careOutreach', () => ({
  listPatientOpenReminders: m.listPatientOpenReminders,
}));
vi.mock('../../api/employee', () => ({ fetchPrimaryProviders: vi.fn(async () => []) }));
vi.mock('../../api/appointmentSettings', async (orig) => ({
  ...(await orig<typeof import('../../api/appointmentSettings')>()),
  fetchAllAppointmentTypes: vi.fn(async () => []),
}));
vi.mock('../../api/visitWorkflow', async (orig) => ({
  ...(await orig<typeof import('../../api/visitWorkflow')>()),
  listEncounters: vi.fn(async () => []),
}));
vi.mock('../../api/visitWrapUp', async (orig) => ({
  ...(await orig<typeof import('../../api/visitWrapUp')>()),
  getVisitReminders: vi.fn(async () => ({ pets: [] })),
}));

import { loadFollowUpPlannerData, type PlannerVisitInput } from './plannerData';

const TZ = 'America/New_York';
// Ana Rivera: Biscuit, Maple and Pepper on today's visit; Juno (two future visits) and
// Olive (no visits at all, overdue reminders) at home.
const visit: PlannerVisitInput = {
  clientId: 50,
  clientName: 'Ana Rivera',
  provider: { id: 7, name: 'Dana Demo' },
  pets: [
    { patientId: 1, name: 'Biscuit', appointmentId: 101, soapEncounterId: 'e1' },
    { patientId: 2, name: 'Maple', appointmentId: 102, soapEncounterId: 'e2' },
    { patientId: 3, name: 'Pepper', appointmentId: 103, soapEncounterId: 'e3' },
  ],
};
const pet = (id: number, name: string) => ({ id, name, isActive: true, isDeleted: false });
const junoVisit = (id: number, start: string) => ({
  id,
  appointmentStart: start,
  appointmentEnd: start.replace(':00:00Z', ':45:00Z'),
  isDeleted: false,
  patient: { id: 4, name: 'Juno' },
  primaryProvider: { id: 7, firstName: 'Dana', lastName: 'Demo' },
  client: { id: 50 },
});

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  m.listPatientOpenReminders.mockResolvedValue([]);
  m.fetchClientAppointmentsStaff.mockResolvedValue([
    junoVisit(901, '2099-11-25T15:00:00Z'),
    junoVisit(902, '2100-01-04T19:00:00Z'),
  ]);
});

describe('loadFollowUpPlannerData: the rest of the household', () => {
  it('includes a pet with no appointments and one with upcoming visits', async () => {
    m.fetchClientByIdStaff.mockResolvedValue({
      id: 50,
      patients: [
        pet(1, 'Biscuit'),
        pet(2, 'Maple'),
        pet(3, 'Pepper'),
        pet(4, 'Juno'),
        pet(5, 'Olive'),
      ],
    });
    const d = await loadFollowUpPlannerData({ visit, practiceId: 1, tz: TZ });
    const home = d.pets.filter((p) => !p.onTodaysVisit).map((p) => p.name);
    expect(home).toEqual(['Juno', 'Olive']);
    expect(d.householdError).toBeNull();
    expect(d.upcoming.map((u) => u.petIds)).toEqual([[4], [4]]);
  });

  it('a pet list that fails to load is retried, then said; pets on upcoming visits still show', async () => {
    m.fetchClientByIdStaff.mockRejectedValue(new Error('502'));
    const d = await loadFollowUpPlannerData({ visit, practiceId: 1, tz: TZ });
    expect(m.fetchClientByIdStaff).toHaveBeenCalledTimes(2);
    expect(d.householdError).toMatch(/Could not load the rest of the household/);
    expect(d.pets.filter((p) => !p.onTodaysVisit).map((p) => p.name)).toEqual(['Juno']);
  });

  it('keeps out pets the list has as inactive even if they have a visit', async () => {
    m.fetchClientByIdStaff.mockResolvedValue({
      id: 50,
      patients: [pet(1, 'Biscuit'), { ...pet(4, 'Juno'), isActive: false }, pet(5, 'Olive')],
    });
    const d = await loadFollowUpPlannerData({ visit, practiceId: 1, tz: TZ });
    expect(d.pets.filter((p) => !p.onTodaysVisit).map((p) => p.name)).toEqual(['Olive']);
  });
});

/**
 * SCH-E: the planner's "Who reviews" for a labs-pending pet opens with the visit doctor and
 * the techs who work with them (a relief doctor alone, with the doctors watching), and staff
 * can change it before Done.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { DateTime } from 'luxon';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FollowUpPlannerData } from './plannerData';

const TZ = 'America/New_York';
const today = DateTime.fromISO('2026-11-03T14:00', { zone: TZ });

const fixture: FollowUpPlannerData = {
  tz: TZ,
  today,
  clientId: 50,
  clientName: 'Ada Okafor',
  clientFirstName: 'Ada',
  clientPhone: '5552140193',
  clientEmails: [],
  doNotSms: true,
  pets: [
    {
      patientId: 4,
      name: 'Biscuit',
      species: 'Dog',
      onTodaysVisit: true,
      appointmentId: 104,
      soapEncounterId: 'e4',
      savedMode: null,
    },
  ],
  remindersByPet: {},
  upcoming: [],
  providers: [{ id: 7, name: 'Lena Crispell', firstName: 'Lena', lastName: 'Crispell' }],
  todayProviderId: 7,
  appointmentTypes: [],
  bookableTypes: [],
};

const actions = vi.hoisted(() => ({
  createPlannerForwardBookings: vi.fn(async () => ({ entries: [], linkedPetIds: [] })),
  startPlannerSlotSearch: vi.fn(() => true),
  removePlannerForwardBookings: vi.fn(),
  removePlannerForwardBookingsOnUnload: vi.fn(),
  findBookedAppointments: vi.fn(async () => []),
  addPetsToUpcomingVisit: vi.fn(),
  undoPlannerBooking: vi.fn(),
  createLabsTask: vi.fn(async () => 77),
  savePetDisposition: vi.fn(),
  sendPlannerConfirmationText: vi.fn(),
}));
const fetchLabsTaskPeople = vi.hoisted(() => vi.fn());

vi.mock('./plannerActions', async (orig) => ({
  ...(await orig<typeof import('./plannerActions')>()),
  ...actions,
}));
vi.mock('./plannerData', async (orig) => ({
  ...(await orig<typeof import('./plannerData')>()),
  loadFollowUpPlannerData: vi.fn(async () => fixture),
}));
vi.mock('../../api/tasks', async (orig) => ({
  ...(await orig<typeof import('../../api/tasks')>()),
  fetchLabsTaskPeople,
}));
vi.mock('../../utils/routingServiceMinutes', async (orig) => ({
  ...(await orig<typeof import('../../utils/routingServiceMinutes')>()),
  fetchDoctorApptLengthStats: vi.fn(async () => []),
}));
vi.mock('../../api/appointments', async (orig) => ({
  ...(await orig<typeof import('../../api/appointments')>()),
  fetchPremedsHistory: vi.fn(async () => []),
}));
vi.mock('../../pages/RoutingCalendarWorkspace', () => ({ default: () => <div>Calendar</div> }));
vi.mock('../../api/appointmentSettings', async (orig) => ({
  ...(await orig<typeof import('../../api/appointmentSettings')>()),
  fetchAllEmployees: vi.fn(async () => [
    { id: 7, firstName: 'Lena', lastName: 'Crispell', email: 'lc@x.test' },
    { id: 21, firstName: 'Jen', lastName: 'Ortiz', email: 'jo@x.test' },
    { id: 22, firstName: 'Sam', lastName: 'Lee', email: 'sl@x.test' },
    { id: 30, firstName: 'Riley', lastName: 'Relief', email: 'rr@x.test' },
    { id: 31, firstName: 'Mo', lastName: 'Director', email: 'md@x.test' },
  ]),
}));
vi.mock('../../api/branchInventory', async (orig) => ({
  ...(await orig<typeof import('../../api/branchInventory')>()),
  listPracticeBranches: vi.fn(async () => [{ id: 1, isActive: true }]),
  getEmployeeBranches: vi.fn(async () => [
    { branchId: 1, isPrimary: true, defaultInventoryLocationId: null },
  ]),
}));

import ScheduleFollowUpsPlanner from './ScheduleFollowUpsPlanner';
import { loadFollowUpPlannerData } from './plannerData';

const staffToken = `x.${btoa(JSON.stringify({ sub: 5, employeeId: 42 }))}.y`;

function renderPlanner() {
  render(
    <ScheduleFollowUpsPlanner
      open
      visit={{
        clientId: 50,
        clientName: 'Ada Okafor',
        pets: [],
        provider: { id: 7, name: 'Lena Crispell' },
      }}
      practiceId={1}
      tz={TZ}
      onClose={vi.fn()}
      onSaved={vi.fn()}
    />
  );
}

async function biscuitToLabs() {
  await screen.findByText(/Today.s visit · needs a plan/);
  fireEvent.click(screen.getByRole('button', { name: /^Biscuit/ }));
  fireEvent.click(screen.getAllByRole('menuitem', { name: /^Labs pending$/ })[0]);
}

const labsCard = () =>
  screen.getByText('Labs pending', { selector: '.fup-card__title' }).closest('article')!;
/** Names on the chips of one picker ("Who reviews" or "Watching"). */
function chips(label: string): string[] {
  const field = within(labsCard())
    .getByText(label)
    .closest('.scheduler-forward-booking-staff-pick')!;
  return within(field as HTMLElement)
    .queryAllByRole('listitem')
    .map((li) => (li.textContent ?? '').replace('×', '').trim());
}

beforeEach(() => {
  localStorage.setItem('accessToken', staffToken);
  Object.values(actions).forEach((fn) => fn.mockClear());
  fetchLabsTaskPeople.mockReset();
});

describe('labs pending: who reviews starts with the right people', () => {
  it.each([
    { techs: [], names: ['Lena Crispell'] },
    { techs: [21], names: ['Lena Crispell', 'Jen Ortiz'] },
    { techs: [21, 22], names: ['Lena Crispell', 'Jen Ortiz', 'Sam Lee'] },
  ])('regular doctor with $techs.length linked tech(s)', async ({ techs, names }) => {
    fetchLabsTaskPeople.mockResolvedValue({
      relief: false,
      assigneeEmployeeIds: [7, ...techs],
      watcherEmployeeIds: [],
    });
    renderPlanner();
    await biscuitToLabs();
    await waitFor(() => expect(chips('Who reviews')).toEqual(names));
    expect(fetchLabsTaskPeople).toHaveBeenCalledWith(7);
    expect(chips('Watching')).toEqual([]);

    fireEvent.click(screen.getByRole('button', { name: /Done/ }));
    await waitFor(() => expect(actions.createLabsTask).toHaveBeenCalledTimes(1));
    expect(actions.createLabsTask.mock.calls[0][0]).toMatchObject({
      assigneeIds: [7, ...techs],
      watcherIds: [],
    });
    const disposition = actions.savePetDisposition.mock.calls[0][0].disposition;
    expect(disposition.labsPendingTask.assignedToEmployeeIds).toEqual([7, ...techs]);
  });

  it('keeps the suggestion when it arrives after the planner has loaded (a real network call)', async () => {
    fetchLabsTaskPeople.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () => resolve({ relief: false, assigneeEmployeeIds: [7, 21], watcherEmployeeIds: [] }),
            50
          )
        )
    );
    renderPlanner();
    await biscuitToLabs();
    await waitFor(() => expect(chips('Who reviews')).toEqual(['Lena Crispell', 'Jen Ortiz']));
  });

  it('relief doctor: the relief doctor does it, the doctors watch', async () => {
    vi.mocked(loadFollowUpPlannerData).mockResolvedValueOnce({ ...fixture, todayProviderId: 30 });
    fetchLabsTaskPeople.mockResolvedValue({
      relief: true,
      assigneeEmployeeIds: [30],
      watcherEmployeeIds: [7, 31],
    });
    renderPlanner();
    await biscuitToLabs();
    await waitFor(() => expect(chips('Watching')).toEqual(['Lena Crispell', 'Mo Director']));
    expect(chips('Who reviews')).toEqual(['Riley Relief']);
    fireEvent.click(screen.getByRole('button', { name: /Done/ }));
    await waitFor(() => expect(actions.createLabsTask).toHaveBeenCalledTimes(1));
    expect(actions.createLabsTask.mock.calls[0][0]).toMatchObject({
      assigneeIds: [30],
      watcherIds: [7, 31],
    });
  });

  it('staff can remove people, but at least one must review', async () => {
    fetchLabsTaskPeople.mockResolvedValue({
      relief: false,
      assigneeEmployeeIds: [7, 21],
      watcherEmployeeIds: [],
    });
    renderPlanner();
    await biscuitToLabs();
    await waitFor(() => expect(chips('Who reviews')).toHaveLength(2));
    fireEvent.click(screen.getByRole('button', { name: 'Remove Jen Ortiz' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove Lena Crispell' }));
    expect(chips('Who reviews')).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: /Done/ }));
    expect(await screen.findByText('Pick who reviews the labs')).toBeTruthy();
    expect(actions.createLabsTask).not.toHaveBeenCalled();
  });

  it('falls back to the doctor alone when the suggestion cannot load', async () => {
    fetchLabsTaskPeople.mockRejectedValue(new Error('offline'));
    renderPlanner();
    await biscuitToLabs();
    await waitFor(() => expect(chips('Who reviews')).toEqual(['Lena Crispell']));
  });
});

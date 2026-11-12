import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { DateTime } from 'luxon';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Appointment } from '../../api/roomLoader';
import type { FollowUpPlannerData } from './plannerData';
import { notifyFollowUpPlannerBooked } from './plannerEvents';

const TZ = 'America/New_York';
const today = DateTime.fromISO('2026-11-03T14:00', { zone: TZ });

const gretaVisit = {
  id: 900,
  appointmentStart: '2026-12-02T15:00:00Z',
  appointmentEnd: '2026-12-02T15:45:00Z',
  appointmentType: { id: 3 },
} as unknown as Appointment;

const apptType = (id: number, name: string, defaultDuration = 30) =>
  ({
    id,
    name,
    prettyName: name,
    isActive: true,
    isDeleted: false,
    isBoardingType: false,
    allowClient: true,
    defaultDuration,
  }) as never;
const TYPES = [apptType(1, 'Wellness'), apptType(2, 'Recheck', 20), apptType(3, 'Ear Recheck', 20)];

const fixture: FollowUpPlannerData = {
  tz: TZ,
  today,
  clientId: 50,
  clientName: 'Ada Okafor',
  clientFirstName: 'Ada',
  clientPhone: '5552140193',
  clientEmails: ['ada@example.com'],
  doNotSms: false,
  pets: [
    {
      patientId: 1,
      name: 'Fluffy',
      species: 'Cat',
      onTodaysVisit: true,
      appointmentId: 101,
      soapEncounterId: 'e1',
      savedMode: null,
    },
    {
      patientId: 2,
      name: 'Angel',
      species: 'Cat',
      onTodaysVisit: true,
      appointmentId: 102,
      soapEncounterId: 'e2',
      savedMode: null,
    },
    {
      patientId: 3,
      name: 'Marvin',
      species: 'Dog',
      onTodaysVisit: true,
      appointmentId: 103,
      soapEncounterId: 'e3',
      savedMode: null,
    },
    {
      patientId: 4,
      name: 'Biscuit',
      species: 'Dog',
      onTodaysVisit: true,
      appointmentId: 104,
      soapEncounterId: 'e4',
      savedMode: null,
    },
    {
      patientId: 5,
      name: 'Greta',
      species: null,
      onTodaysVisit: false,
      appointmentId: null,
      soapEncounterId: null,
      savedMode: null,
    },
    {
      patientId: 6,
      name: 'Pepper',
      species: null,
      onTodaysVisit: false,
      appointmentId: null,
      soapEncounterId: null,
      savedMode: null,
    },
  ],
  remindersByPet: {
    3: [
      {
        key: 'o:1',
        name: 'Lyme C6 ELISA',
        due: DateTime.fromISO('2026-12-16', { zone: TZ }),
        fromToday: false,
      },
    ],
    6: [
      {
        key: 'o:2',
        name: 'FVRCP',
        due: DateTime.fromISO('2026-08-14', { zone: TZ }),
        fromToday: false,
      },
    ],
  },
  upcoming: [
    {
      key: '900',
      start: DateTime.fromISO('2026-12-02T10:00', { zone: TZ }),
      end: DateTime.fromISO('2026-12-02T10:45', { zone: TZ }),
      windowStart: DateTime.fromISO('2026-12-02T10:00', { zone: TZ }),
      windowEnd: DateTime.fromISO('2026-12-02T12:00', { zone: TZ }),
      provider: { id: 7, name: 'Priya Patel', firstName: 'Priya', lastName: 'Patel' },
      typeName: 'Recheck',
      appointments: [gretaVisit],
      petIds: [5],
    },
  ],
  providers: [
    { id: 7, name: 'Priya Patel', firstName: 'Priya', lastName: 'Patel' },
    { id: 9, name: 'Tech Team' },
  ],
  todayProviderId: 7,
  appointmentTypes: TYPES,
  bookableTypes: TYPES,
};

const actions = vi.hoisted(() => ({
  createPlannerForwardBookings: vi.fn(),
  startPlannerSlotSearch: vi.fn(() => true),
  removePlannerForwardBookings: vi.fn(),
  removePlannerForwardBookingsOnUnload: vi.fn(),
  findBookedAppointments: vi.fn(),
  addPetsToUpcomingVisit: vi.fn(),
  undoPlannerBooking: vi.fn(),
  createLabsTask: vi.fn(async () => 77),
  savePetDisposition: vi.fn(),
  sendPlannerConfirmationText: vi.fn(),
}));

vi.mock('./plannerActions', async (orig) => ({
  ...(await orig<typeof import('./plannerActions')>()),
  ...actions,
}));
vi.mock('./plannerData', async (orig) => ({
  ...(await orig<typeof import('./plannerData')>()),
  loadFollowUpPlannerData: vi.fn(async () => fixture),
}));
// The labs task looks up who to assign (Nov 4). Unmocked, the real request fails, the token
// refresh finds no refresh token and signs the test out, so later tests lose the staff name.
vi.mock('../../api/tasks', async (orig) => ({
  ...(await orig<typeof import('../../api/tasks')>()),
  fetchLabsTaskPeople: vi.fn(async () => ({ relief: false, assigneeEmployeeIds: [], watcherEmployeeIds: [] })),
}));
vi.mock('./visitImpact', async (orig) => ({
  ...(await orig<typeof import('./visitImpact')>()),
  loadAddPetImpact: vi.fn(async () => ({
    newEnd: DateTime.fromISO('2026-12-02T11:05', { zone: TZ }),
    laterStops: [
      {
        key: 'ruiz',
        client: 'Ruiz household',
        windowStart: DateTime.fromISO('2026-12-02T13:30', { zone: TZ }),
        windowEnd: DateTime.fromISO('2026-12-02T15:00', { zone: TZ }),
        etaBefore: DateTime.fromISO('2026-12-02T14:45', { zone: TZ }),
        etaAfter: DateTime.fromISO('2026-12-02T15:05', { zone: TZ }),
        warns: true,
        minutesPastWindow: 5,
      },
    ],
  })),
}));
vi.mock('../../utils/routingServiceMinutes', async (orig) => ({
  ...(await orig<typeof import('../../utils/routingServiceMinutes')>()),
  // Dr. Patel: recheck 25 min alone, 20 min per pet in a household.
  fetchDoctorApptLengthStats: vi.fn(async () => [
    { typeName: 'Recheck', avgMinutes: 25, count: 10, multipetAvgMinutes: 20, multipetCount: 8 },
    {
      typeName: 'Ear Recheck',
      avgMinutes: 30,
      count: 10,
      multipetAvgMinutes: 22,
      multipetCount: 8,
    },
  ]),
}));
vi.mock('../../api/appointments', async (orig) => ({
  ...(await orig<typeof import('../../api/appointments')>()),
  fetchPremedsHistory: vi.fn(async () => []),
}));
vi.mock('../../pages/RoutingCalendarWorkspace', () => ({
  default: ({ startRoutingCollapsed }: { startRoutingCollapsed?: boolean }) => (
    <div>{startRoutingCollapsed ? 'Embedded calendar only' : 'Embedded calendar'}</div>
  ),
}));
const bestFit = vi.hoisted(() => ({
  searchPlannerBestFit: vi.fn(),
  bookBestFitSlot: vi.fn(),
  internalDoctorIdForPims: vi.fn(async () => '7'),
}));
vi.mock('./plannerBestFit', async (orig) => ({
  ...(await orig<typeof import('./plannerBestFit')>()),
  ...bestFit,
}));
vi.mock('../../api/appointmentSettings', async (orig) => ({
  ...(await orig<typeof import('../../api/appointmentSettings')>()),
  fetchAllEmployees: vi.fn(async () => [
    { id: 7, firstName: 'Priya', lastName: 'Patel', email: 'p@x.com' },
  ]),
  // The signed-in staff member (employee 42 in the token below).
  fetchEmployee: vi.fn(async () => ({ id: 42, firstName: 'Casey', lastName: 'Demo', title: 'CSR' })),
}));
vi.mock('../../api/branchInventory', async (orig) => ({
  ...(await orig<typeof import('../../api/branchInventory')>()),
  // The practice has several offices; the signed-in staff member works at two of them.
  listPracticeBranches: vi.fn(async () => [
    { id: 1, isActive: true },
    { id: 2, isActive: true },
    { id: 3, isActive: true },
    { id: 4, isActive: false },
  ]),
  getEmployeeBranches: vi.fn(async () => [
    { branchId: 3, isPrimary: true, defaultInventoryLocationId: null },
    { branchId: 4, isPrimary: false, defaultInventoryLocationId: null },
  ]),
}));

import ScheduleFollowUpsPlanner from './ScheduleFollowUpsPlanner';
import { fetchPremedsHistory } from '../../api/appointments';
import { getEmployeeBranches } from '../../api/branchInventory';
import { loadFollowUpPlannerData as loadPlannerDataMock } from './plannerData';

const visit = {
  clientId: 50,
  clientName: 'Ada Okafor',
  pets: [],
  provider: { id: 7, name: 'Priya Patel' },
};

function renderPlanner(onClose = vi.fn(), onSaved = vi.fn()) {
  render(
    <ScheduleFollowUpsPlanner
      open
      visit={visit}
      practiceId={1}
      tz={TZ}
      onClose={onClose}
      onSaved={onSaved}
    />
  );
  return { onClose, onSaved };
}

/** Tap a pet in the list (or on a card) and pick a menu item. */
function pick(petButton: HTMLElement, item: RegExp, which: 'first' | 'last' = 'first') {
  fireEvent.click(petButton);
  const items = screen.getAllByRole('menuitem', { name: item });
  fireEvent.click(which === 'first' ? items[0] : items[items.length - 1]);
}
const trayPet = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}`) });
const cardTitled = (title: string) => screen.getByText(title).closest('article') as HTMLElement;
/** Pick a pet's visit type on a card (cards start at "Choose…"). */
const setType = (scope: HTMLElement, petName: string, typeId: number) =>
  fireEvent.change(within(scope).getByLabelText(`Visit type for ${petName}`), {
    target: { value: String(typeId) },
  });

/** A signed-in staff token (employee 42); only its payload is read. */
const staffToken = `x.${btoa(JSON.stringify({ sub: 5, employeeId: 42 }))}.y`;

beforeEach(() => {
  localStorage.setItem('accessToken', staffToken);
  Object.values(actions).forEach((fn) => fn.mockClear());
  Object.values(bestFit).forEach((fn) => fn.mockClear());
  bestFit.searchPlannerBestFit.mockResolvedValue({
    slots: [],
    place: { address: '1 Elm St, Portland, ME 04101', lat: 43.66, lon: -70.25 },
    doctorPimsId: 'P7',
    error: null,
  });
  bestFit.bookBestFitSlot.mockResolvedValue({
    appointmentIds: [555],
    startIso: '2026-11-16T14:00:00Z',
    endIso: '2026-11-16T15:00:00Z',
    providerId: 7,
    warnings: [],
  });
  actions.createPlannerForwardBookings.mockImplementation(
    async ({ pets }: { pets: { patientId: number }[] }) => ({
      entries: pets.map((p, i) => ({ id: 500 + i, patientId: p.patientId })),
      linkedPetIds: [],
    })
  );
  actions.startPlannerSlotSearch.mockReturnValue(true);
  actions.findBookedAppointments.mockResolvedValue([
    {
      id: 555,
      appointmentStart: '2026-11-16T14:00:00Z',
      appointmentEnd: '2026-11-16T15:00:00Z',
      isDeleted: false,
    },
  ]);
  actions.addPetsToUpcomingVisit.mockResolvedValue({
    appointmentIds: [601],
    start: fixture.upcoming[0].start,
    windowStart: fixture.upcoming[0].windowStart,
    windowEnd: fixture.upcoming[0].windowEnd,
    provider: fixture.providers[0],
    bookedAtMs: Date.now(),
    entryIds: [],
  });
});

describe('Schedule follow-ups planner', () => {
  it('runs the Okafor scenario end to end', async () => {
    const { onSaved } = renderPlanner();
    await screen.findByText(/Today.s visit · needs a plan/);

    // Fluffy, Angel and Marvin onto the 1-year card.
    for (const name of ['Fluffy', 'Angel', 'Marvin']) pick(trayPet(name), /"In 1 year" card/);
    const yearCard = cardTitled('In 1 year');
    expect(within(yearCard).getByText('Marvin')).toBeTruthy();

    // Marvin also gets a 2-week recheck card.
    pick(
      within(yearCard).getByRole('button', { name: /^Marvin: move/ }),
      /A new follow-up card/,
      'first'
    );
    const monthCard = cardTitled('In 1 month');
    fireEvent.click(within(monthCard).getByRole('button', { name: '2 weeks' }));
    const weeksCard = cardTitled('In 2 weeks');
    expect(within(weeksCard).getByText('Marvin')).toBeTruthy();
    expect(within(yearCard).getByText('Marvin')).toBeTruthy();
    // His Lyme test (Dec 16) can be done at the 2-week recheck.
    expect(within(weeksCard).getByText('Can be done at this visit')).toBeTruthy();

    // Biscuit → labs pending.
    pick(trayPet('Biscuit'), /^Labs pending$/);

    // Pepper (not on today's visit) onto Greta's Dec 2 visit: warns about the Ruiz stop.
    pick(trayPet('Pepper'), /visit · Wed, Dec 2/);
    await screen.findByText(/5 min past their window/);
    // Pepper defaults to Greta's visit type; history prices the extra time:
    // Ear Recheck alone 30 → two pets 2 × 22 = 44, so about 14 more minutes.
    expect(await screen.findByText(/Adds about 14 min \(Dr. Patel's last 30 days\)/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add anyway' }));
    await waitFor(() => expect(actions.addPetsToUpcomingVisit).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/Pepper added\./)).toBeTruthy();

    // Each pet's visit type is picked by hand: annual for the 1-year card, recheck for Marvin.
    for (const name of ['Fluffy', 'Angel', 'Marvin']) setType(cardTitled('In 1 year'), name, 1);
    setType(cardTitled('In 2 weeks'), 'Marvin', 2);

    // 1-year card to the CLs with a household note.
    fireEvent.click(within(yearCard).getByRole('button', { name: 'Send to CLs to book' }));
    fireEvent.change(screen.getByLabelText(/Note for the CLs/), {
      target: { value: 'Prefers Tuesdays' },
    });

    // Book the 2-week card in the embedded calendar.
    fireEvent.click(
      within(cardTitled('In 2 weeks')).getByRole('button', { name: 'Find a time now' })
    );
    await screen.findByRole('dialog', { name: 'Find a time' });
    // Marvin's Recheck; history says 25 min for one pet.
    expect(actions.startPlannerSlotSearch.mock.calls[0][1]).toEqual({
      appointmentTypeId: 2,
      appointmentTypeName: 'Recheck',
      serviceMinutes: 25,
    });
    act(() =>
      notifyFollowUpPlannerBooked({
        appointmentId: 555,
        startIso: '2026-11-16T14:00:00Z',
        endIso: '2026-11-16T15:00:00Z',
        primaryProviderId: 9,
      })
    );
    await screen.findByText(/✓ Booked · Mon, Nov 16/);
    expect(screen.queryByText('Embedded calendar')).toBeNull();

    // Done saves everything, then offers the text.
    fireEvent.click(screen.getByRole('button', { name: /Done/ }));
    await screen.findByText('Confirmation text');
    const modes = Object.fromEntries(
      actions.savePetDisposition.mock.calls.map(([d]) => [d.pet.name, d.disposition.mode])
    );
    expect(modes).toEqual({
      Fluffy: 'forward_book_fields',
      Angel: 'forward_book_fields',
      Marvin: 'booked_at_appointment',
      Biscuit: 'labs_pending',
    });
    expect(actions.createLabsTask).toHaveBeenCalledTimes(1);
    // SCH-13-4: the labs task is filed using the signed-in staff member's branches, not
    // every branch of the practice (the API refuses branches staff do not belong to).
    expect(getEmployeeBranches).toHaveBeenCalledWith(1, 42);
    expect(actions.createLabsTask.mock.calls[0][0]).toMatchObject({
      practiceId: 1,
      staffBranchIds: [3, 4],
      practiceBranchIds: [1, 2, 3],
    });
    expect(actions.createLabsTask.mock.calls[0][0]).not.toHaveProperty('branchIds');
    const clCall = actions.createPlannerForwardBookings.mock.calls.at(-1)![0];
    expect(clCall.pets.map((p: { name: string }) => p.name)).toEqual(['Fluffy', 'Angel', 'Marvin']);
    expect(clCall.notesFor(clCall.pets[0])).toContain('Household: Prefers Tuesdays');
    expect(onSaved).toHaveBeenCalled();

    const box = screen.getByLabelText('Text message to the owner') as HTMLTextAreaElement;
    await waitFor(() => expect(box.value).not.toBe(''));
    const text = box.value;
    expect(text).toContain('• Marvin: Mon, Nov 16, 2026');
    expect(text).toContain('with our tech team');
    expect(text).toContain('• Pepper: Wed, Dec 2, 2026');
    expect(text).toContain('(same visit as Greta)');
    expect(text).toContain('Fluffy, Angel & Marvin');
    expect(text).toContain('Biscuit once lab results are back');
    // Earliest visit is the tech team's, so the main line sends it.
    expect(screen.getByText(/from the practice main line/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Send text & finish' }));
    await waitFor(() => expect(actions.sendPlannerConfirmationText).toHaveBeenCalledTimes(1));
    expect(actions.sendPlannerConfirmationText.mock.calls[0][0].sendProvider).toBeNull();
  });

  it('sends the confirmation text once when Send text & finish is double clicked', async () => {
    let release!: () => void;
    actions.sendPlannerConfirmationText.mockImplementation(
      () => new Promise<void>((resolve) => (release = resolve))
    );
    renderPlanner();
    await screen.findByText(/Today.s visit · needs a plan/);
    for (const name of ['Fluffy', 'Angel', 'Marvin']) pick(trayPet(name), /"In 1 year" card/);
    pick(trayPet('Biscuit'), /^Labs pending$/);
    pick(trayPet('Pepper'), /visit · Wed, Dec 2/);
    await screen.findByText(/5 min past their window/);
    fireEvent.click(screen.getByRole('button', { name: 'Add anyway' }));
    await screen.findByText(/Pepper added\./);
    for (const name of ['Fluffy', 'Angel', 'Marvin']) setType(cardTitled('In 1 year'), name, 1);
    fireEvent.click(
      within(cardTitled('In 1 year')).getByRole('button', { name: 'Send to CLs to book' })
    );
    fireEvent.click(screen.getByRole('button', { name: /Done/ }));
    await screen.findByText('Confirmation text');
    const box = screen.getByLabelText('Text message to the owner') as HTMLTextAreaElement;
    await waitFor(() => expect(box.value).not.toBe(''));

    const send = screen.getByRole('button', { name: 'Send text & finish' });
    // Two clicks in the same tick, before React re-renders the button as disabled.
    act(() => {
      send.click();
      send.click();
    });
    await act(async () => {
      release();
    });
    expect(actions.sendPlannerConfirmationText).toHaveBeenCalledTimes(1);
  });

  it('warns before closing with unsaved work', async () => {
    const { onClose } = renderPlanner();
    await screen.findByText(/Today.s visit · needs a plan/);
    pick(trayPet('Biscuit'), /^Labs pending$/);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.getByText(/Follow-ups aren.t finished/)).toBeTruthy();
    expect(screen.getByText(/Biscuit → labs pending task/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Keep working' }));
    expect(screen.queryByText(/Follow-ups aren.t finished/)).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('offers Undo right after booking, which frees the card again', async () => {
    renderPlanner();
    await screen.findByText(/Today.s visit · needs a plan/);
    pick(trayPet('Fluffy'), /"In 1 year" card/);
    setType(cardTitled('In 1 year'), 'Fluffy', 1);
    fireEvent.click(screen.getByRole('button', { name: 'Find a time now' }));
    await screen.findByRole('dialog', { name: 'Find a time' });
    act(() =>
      notifyFollowUpPlannerBooked({
        appointmentId: 555,
        startIso: '2026-11-16T14:00:00Z',
        endIso: null,
        primaryProviderId: 7,
      })
    );
    await screen.findByText(/✓ Booked/);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(actions.undoPlannerBooking).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('button', { name: 'Find a time now' })).toBeTruthy();
  });

  it('removes the search rows when the calendar is closed without booking', async () => {
    renderPlanner();
    await screen.findByText(/Today.s visit · needs a plan/);
    pick(trayPet('Angel'), /"In 1 year" card/);
    setType(cardTitled('In 1 year'), 'Angel', 1);
    fireEvent.click(screen.getByRole('button', { name: 'Find a time now' }));
    await screen.findByRole('dialog', { name: 'Find a time' });
    fireEvent.click(screen.getByRole('button', { name: 'Back to plan' }));
    await waitFor(() =>
      expect(actions.removePlannerForwardBookings).toHaveBeenCalledWith([500], 1)
    );
    expect(await screen.findByRole('button', { name: 'Find a time now' })).toBeTruthy();
  });

  it('takes search rows back off the list when the planner goes away mid-search', async () => {
    const { unmount } = render(
      <ScheduleFollowUpsPlanner
        open
        visit={visit}
        practiceId={1}
        tz={TZ}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );
    await screen.findByText(/Today.s visit · needs a plan/);
    pick(trayPet('Angel'), /"In 1 year" card/);
    setType(cardTitled('In 1 year'), 'Angel', 1);
    fireEvent.click(screen.getByRole('button', { name: 'Find a time now' }));
    await screen.findByRole('dialog', { name: 'Find a time' });
    window.dispatchEvent(new Event('pagehide'));
    expect(actions.removePlannerForwardBookingsOnUnload).toHaveBeenCalledWith([500], 1);
    unmount();
    expect(actions.removePlannerForwardBookings).toHaveBeenCalledWith([500], 1);
  });

  it('labs are back: the pet needs a plan, and Done reports what was done for the task', async () => {
    const { loadFollowUpPlannerData } = await import('./plannerData');
    vi.mocked(loadFollowUpPlannerData).mockResolvedValueOnce({
      ...fixture,
      todayProviderId: null,
      pets: fixture.pets.map((p) => ({
        ...p,
        onTodaysVisit: false,
        appointmentId: null,
        soapEncounterId: null,
        ...(p.patientId === 4 ? { focusReason: 'Labs are back', sourceAppointmentId: 104 } : {}),
      })),
    });
    const onSaved = vi.fn();
    render(
      <ScheduleFollowUpsPlanner
        open
        visit={visit}
        practiceId={1}
        tz={TZ}
        onClose={vi.fn()}
        onSaved={onSaved}
      />
    );
    await screen.findByText('Labs are back · needs a plan');
    fireEvent.click(screen.getByRole('button', { name: /Done/ }));
    expect(await screen.findByText(/Still needs a follow-up: Biscuit/)).toBeTruthy();

    pick(trayPet('Biscuit'), /No follow-up needed/);
    fireEvent.click(screen.getByRole('button', { name: 'Client declined' }));
    fireEvent.click(screen.getByRole('button', { name: /Done/ }));
    await waitFor(() =>
      expect(onSaved).toHaveBeenCalledWith({
        focusSummary: 'Biscuit: no follow-up needed (Client declined).',
      })
    );
    // The earlier visit keeps its saved Labs pending choice.
    expect(actions.savePetDisposition).not.toHaveBeenCalled();
  });

  it('gives each pet its own visit type and pre-meds, and the household the pre-meds window', async () => {
    // Staff see the type's own name, not the client-facing pretty name.
    const types = [
      apptType(1, 'Wellness'),
      { ...(apptType(2, 'RCHK', 20) as object), prettyName: 'Recheck / follow-up' } as never,
      apptType(3, 'Ear Recheck', 20),
    ];
    vi.mocked(loadPlannerDataMock).mockResolvedValueOnce({
      ...fixture,
      appointmentTypes: types,
      bookableTypes: types,
    });
    // Angel's last visit had pre-meds; Fluffy's did not.
    vi.mocked(fetchPremedsHistory).mockResolvedValueOnce([
      {
        patientId: 2,
        source: 'visit',
        premedsNote: null,
        appointmentId: 77,
        appointmentStart: '2026-09-01T14:00:00Z',
        appointmentTypeName: 'Wellness',
      },
    ]);
    renderPlanner();
    await screen.findByText(/Today.s visit · needs a plan/);
    for (const name of ['Fluffy', 'Angel']) pick(trayPet(name), /"In 1 year" card/);
    const card = cardTitled('In 1 year');

    // One picker per pet, listing staff names.
    const fluffyType = within(card).getByLabelText('Visit type for Fluffy') as HTMLSelectElement;
    const angelType = within(card).getByLabelText('Visit type for Angel') as HTMLSelectElement;
    expect(within(fluffyType).getByRole('option', { name: 'RCHK' })).toBeTruthy();
    expect(within(fluffyType).queryByRole('option', { name: 'Recheck / follow-up' })).toBeNull();
    expect(within(card).queryByRole('combobox', { name: 'Visit type' })).toBeNull();
    fireEvent.change(fluffyType, { target: { value: '1' } });
    fireEvent.change(angelType, { target: { value: '3' } });

    // Pre-meds per pet: Angel pre-checked from history, Fluffy not.
    const angelPremeds = within(card).getByLabelText('Angel needs pre-meds') as HTMLInputElement;
    await waitFor(() => expect(angelPremeds.checked).toBe(true));
    expect((within(card).getByLabelText('Fluffy needs pre-meds') as HTMLInputElement).checked).toBe(
      false
    );
    expect(
      within(card).getByText(/last visit \(Sep 1, 2026 · Wellness\) had pre-meds/)
    ).toBeTruthy();
    // One pet on pre-meds narrows the window for the whole household.
    expect(
      within(card).getByText(
        'Angel needs pre-meds, so every pet on this visit gets the 1-hour arrival window.'
      )
    ).toBeTruthy();

    // The doctor is chosen once for the household, above the pets.
    const keep = within(card).getByLabelText(/Keep Dr\. Patel/);
    const firstPet = within(card).getByRole('button', { name: /^Fluffy: move/ });
    expect(keep.compareDocumentPosition(firstPet) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.click(within(card).getByRole('button', { name: 'Find a time now' }));
    await screen.findByRole('dialog', { name: 'Find a time' });
    const call = actions.createPlannerForwardBookings.mock.calls.at(-1)![0];
    const [fluffy, angel] = call.pets;
    expect([call.typeIdFor(fluffy), call.typeIdFor(angel)]).toEqual([1, 3]);
    expect([call.premedsFor(fluffy), call.premedsFor(angel)]).toEqual([false, true]);
    // Routing searches with the first pet's type (staff name).
    expect(actions.startPlannerSlotSearch.mock.calls.at(-1)![1]).toMatchObject({
      appointmentTypeId: 1,
      appointmentTypeName: 'Wellness',
    });
  });

  it('starts every pet at "Choose…" and will not book or send until each has a type', async () => {
    renderPlanner();
    await screen.findByText(/Today.s visit · needs a plan/);
    for (const name of ['Fluffy', 'Angel']) pick(trayPet(name), /"In 1 year" card/);
    const card = cardTitled('In 1 year');
    expect((within(card).getByLabelText('Visit type for Fluffy') as HTMLSelectElement).value).toBe(
      ''
    );

    setType(card, 'Fluffy', 1);
    fireEvent.click(within(card).getByRole('button', { name: 'Find a time now' }));
    expect(await screen.findAllByText('Pick a visit type for Angel')).toBeTruthy();
    expect(within(card).getByLabelText('Visit type for Angel').getAttribute('aria-invalid')).toBe(
      'true'
    );
    fireEvent.click(within(card).getByRole('button', { name: 'Send to CLs to book' }));
    expect(screen.queryByText(/Goes to the CLs when you press Done/)).toBeNull();
    expect(actions.createPlannerForwardBookings).not.toHaveBeenCalled();
    expect(actions.startPlannerSlotSearch).not.toHaveBeenCalled();

    setType(card, 'Angel', 1);
    expect(within(card).queryByText('Pick a visit type for Angel')).toBeNull();
    fireEvent.click(within(card).getByRole('button', { name: 'Find a time now' }));
    await screen.findByRole('dialog', { name: 'Find a time' });
  });
});

describe('Find a time now: best-fit panel that books directly', () => {
  const slot = {
    key: 'P7-2027-11-02-0-0',
    date: '2027-11-02',
    suggestedStartIso: '2027-11-02T14:00:00Z',
    windowStartIso: '2027-11-02T13:00:00Z',
    windowEndIso: '2027-11-02T15:00:00Z',
    doctorPimsId: 'P7',
    doctorName: 'Priya Patel',
    score: 12.5,
    addedDriveSeconds: 360,
    projectedDriveSeconds: 4800,
    emptyDay: false,
    isFallbackDoctor: false,
    dayVisitCount: 4,
    zoneName: 'Eastside',
    option: { date: '2027-11-02', suggestedStartIso: '2027-11-02T14:00:00Z', insertionIndex: 1 },
  };
  const second = {
    ...slot,
    key: 'P7-2027-11-05-2-1',
    date: '2027-11-05',
    suggestedStartIso: '2027-11-05T15:30:00Z',
    windowStartIso: '2027-11-05T15:30:00Z',
    windowEndIso: '2027-11-05T17:30:00Z',
    score: 40,
    addedDriveSeconds: 840,
    dayVisitCount: 1,
  };
  const found = (slots = [slot, second]) =>
    bestFit.searchPlannerBestFit.mockResolvedValue({
      slots,
      place: { address: '1 Elm St', lat: 43.66, lon: -70.25 },
      doctorPimsId: 'P7',
      error: null,
    });

  /** Fluffy on the 1-year card; `need` is typed into the card's "What does Fluffy need?". */
  async function openPanelForFluffy(need?: string) {
    renderPlanner();
    await screen.findByText(/Today.s visit · needs a plan/);
    pick(trayPet('Fluffy'), /"In 1 year" card/);
    const card = cardTitled('In 1 year');
    setType(card, 'Fluffy', 1);
    if (need)
      fireEvent.change(within(card).getByLabelText('What Fluffy needs'), {
        target: { value: need },
      });
    fireEvent.click(screen.getByRole('button', { name: 'Find a time now' }));
    return screen.findByRole('dialog', { name: 'Find a time' });
  }

  it('looks like the prototype: header, preferences, ranked slot cards, no calendar', async () => {
    found();
    const panel = await openPanelForFluffy();
    expect(within(panel).getByRole('heading', { name: 'Find a time · Fluffy' })).toBeTruthy();
    expect(
      within(panel).getByText(/^In 1 year · about \d+ min · target Nov 3, 2027 · Dr\. Patel$/)
    ).toBeTruthy();
    expect(within(panel).getByRole('button', { name: 'Back to plan' })).toBeTruthy();
    expect(within(panel).getByText('What works for the owner?')).toBeTruthy();
    for (const chip of ['Any time', 'Mornings', 'Afternoons', 'Any day', 'Friday'])
      expect(within(panel).getByRole('button', { name: chip })).toBeTruthy();
    expect(
      within(panel).getByText(
        'Best route matches near the target date, ranked by drive time and how full that day is.'
      )
    ).toBeTruthy();

    // Same request Routing would get: client, the card's pets, type, minutes, doctor,
    // pre-meds and the card's target window (Nov 3, 2027 ±7 days).
    await waitFor(() => expect(bestFit.searchPlannerBestFit).toHaveBeenCalledTimes(1));
    const minutes = actions.startPlannerSlotSearch.mock.calls[0][1].serviceMinutes;
    expect(bestFit.searchPlannerBestFit.mock.calls[0][0]).toMatchObject({
      tz: TZ,
      asap: false,
      prefs: { weekdays: [], timeOfDay: null, earliest: false },
      req: {
        clientId: 50,
        providerId: 7,
        appointmentTypeId: 1,
        statsTypeKey: 'Wellness',
        serviceMinutes: minutes,
        needsPremeds: false,
        pets: [{ id: 1, name: 'Fluffy' }],
        window: { startDate: '2027-10-27', endDate: '2027-11-10' },
      },
    });

    const items = await within(panel).findAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain('Tue, Nov 2, 2027 · 9:00–11:00 AM arrival');
    expect(items[0].textContent).toContain('Best fit');
    expect(items[0].textContent).toContain(
      'Dr. Patel already has 4 visits in Eastside that day · 6 min extra drive'
    );
    expect(items[1].textContent).toContain('Fri, Nov 5, 2027 · 11:30 AM–1:30 PM arrival');
    expect(items[1].textContent).toContain('Good');
    expect(items[1].textContent).toContain(
      'Light day for Dr. Patel in Eastside · 14 min extra drive'
    );
    expect(within(items[0]).getByRole('button', { name: /^Book Tue, Nov 2, 2027/ })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Open the full calendar in a new tab' })
    ).toBeTruthy();
    expect(screen.queryByText(/Embedded calendar/)).toBeNull();
  });

  it('changing a preference searches again with it', async () => {
    found();
    const panel = await openPanelForFluffy();
    await waitFor(() => expect(bestFit.searchPlannerBestFit).toHaveBeenCalledTimes(1));
    await within(panel).findAllByRole('listitem');

    fireEvent.click(within(panel).getByRole('button', { name: 'Mornings' }));
    await waitFor(() => expect(bestFit.searchPlannerBestFit).toHaveBeenCalledTimes(2));
    expect(bestFit.searchPlannerBestFit.mock.calls[1][0].prefs).toEqual({
      weekdays: [],
      timeOfDay: 'first',
      earliest: false,
    });
    await within(panel).findAllByRole('listitem');

    fireEvent.click(within(panel).getByRole('button', { name: 'Tuesday' }));
    fireEvent.click(within(panel).getByRole('button', { name: 'Thursday' }));
    await waitFor(() => expect(bestFit.searchPlannerBestFit).toHaveBeenCalledTimes(4));
    expect(bestFit.searchPlannerBestFit.mock.calls[3][0].prefs).toEqual({
      weekdays: [2, 4],
      timeOfDay: 'first',
      earliest: false,
    });
    expect(
      within(panel).getByRole('button', { name: 'Tuesday' }).getAttribute('aria-pressed')
    ).toBe('true');

    fireEvent.click(within(panel).getByRole('button', { name: 'Any doctor in zone' }));
    await waitFor(() => expect(bestFit.searchPlannerBestFit).toHaveBeenCalledTimes(5));
    expect(bestFit.searchPlannerBestFit.mock.calls[4][0]).toMatchObject({
      asap: true,
      prefs: { weekdays: [2, 4], timeOfDay: 'first' },
    });
  });

  it('Book stays off until "What does Fluffy need?" is filled; the card note prefills it', async () => {
    found();
    const panel = await openPanelForFluffy();
    const book = await within(panel).findByRole('button', { name: /^Book Tue, Nov 2, 2027/ });
    const need = within(panel).getByLabelText('What does Fluffy need?') as HTMLInputElement;
    expect(need.value).toBe('');
    expect((book as HTMLButtonElement).disabled).toBe(true);
    expect(within(panel).getByText('Say what Fluffy needs to book.')).toBeTruthy();
    fireEvent.click(book);
    expect(bestFit.bookBestFitSlot).not.toHaveBeenCalled();
    fireEvent.change(need, { target: { value: 'annual exam' } });
    expect((book as HTMLButtonElement).disabled).toBe(false);
  });

  it('Book books right there with the routing booking and returns to the booked card', async () => {
    found();
    const panel = await openPanelForFluffy('annual exam');
    const need = within(panel).getByLabelText('What does Fluffy need?') as HTMLInputElement;
    expect(need.value).toBe('annual exam');
    fireEvent.click(await within(panel).findByRole('button', { name: /^Book Tue, Nov 2, 2027/ }));

    await waitFor(() => expect(bestFit.bookBestFitSlot).toHaveBeenCalledTimes(1));
    const arg = bestFit.bookBestFitSlot.mock.calls[0][0];
    expect(arg).toMatchObject({
      practiceId: 1,
      tz: TZ,
      slot,
      place: { address: '1 Elm St', lat: 43.66, lon: -70.25 },
      req: { clientId: 50, appointmentTypeId: 1, pets: [{ id: 1, name: 'Fluffy' }] },
      visits: [
        { patientId: 1, appointmentTypeId: 1, needsPremeds: false, description: 'annual exam' },
      ],
    });
    expect('intent' in arg).toBe(true);

    // A short confirmation in the panel, then back to the plan with the card booked.
    expect(
      await within(panel).findByText(/✓ Booked Fluffy · Tue, Nov 2, 2027 · 9:00–11:00 AM arrival/)
    ).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Find a time' })).toBeNull(), {
      timeout: 3000,
    });
    expect(await screen.findByText(/✓ Booked · Mon, Nov 16/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy();
    expect(actions.findBookedAppointments).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: 50, petIds: [1], startIso: '2026-11-16T14:00:00Z' })
    );
    expect(actions.removePlannerForwardBookings).not.toHaveBeenCalled();
    expect(screen.queryByText(/Embedded calendar/)).toBeNull();
  });

  it('a failed booking says why and stays on the list', async () => {
    found();
    bestFit.bookBestFitSlot.mockRejectedValueOnce(new Error('That time was just taken.'));
    const panel = await openPanelForFluffy('annual exam');
    fireEvent.click(await within(panel).findByRole('button', { name: /^Book Tue, Nov 2, 2027/ }));
    expect(await within(panel).findByText('That time was just taken.')).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'Find a time' })).toBeTruthy();
    expect(screen.queryByText(/✓ Booked ·/)).toBeNull();
  });

  it('Open the full calendar opens the calendar page in a new tab; the planner stays here', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue({} as Window);
    try {
      const panel = await openPanelForFluffy();
      await within(panel).findByText(/No openings near the target date/);
      fireEvent.click(
        within(panel).getByRole('button', { name: 'Open the full calendar in a new tab' })
      );
      expect(open).toHaveBeenCalledTimes(1);
      const [url, target] = open.mock.calls[0];
      expect(String(url)).toMatch(/^\/schedule\/routing(\?fbHandoff=.+)?$/);
      expect(target).toBe('_blank');
      // Nothing here moves: the panel and the search rows stay, and no calendar opens.
      expect(screen.getByRole('dialog', { name: 'Find a time' })).toBeTruthy();
      expect(screen.queryByText(/Embedded calendar/)).toBeNull();
      expect(within(panel).getByText(/The calendar is open in another tab/)).toBeTruthy();
      expect(actions.removePlannerForwardBookings).not.toHaveBeenCalled();

      // A booking made in that tab comes back to this card.
      act(() =>
        notifyFollowUpPlannerBooked({
          appointmentId: 556,
          startIso: '2026-11-16T14:00:00Z',
          endIso: '2026-11-16T15:00:00Z',
          primaryProviderId: 7,
        })
      );
      await screen.findByText(/✓ Booked · Mon, Nov 16/);
      expect(screen.queryByRole('dialog', { name: 'Find a time' })).toBeNull();
    } finally {
      open.mockRestore();
    }
  });
});

describe('Rest of household', () => {
  it('lists a household pet with no appointments; one with visits sits on her upcoming visit', async () => {
    vi.mocked(loadPlannerDataMock).mockResolvedValueOnce({
      ...fixture,
      pets: [
        ...fixture.pets.filter((p) => p.onTodaysVisit),
        { ...fixture.pets[4], patientId: 7, name: 'Juno' },
        { ...fixture.pets[4], patientId: 8, name: 'Olive' },
      ],
      remindersByPet: {
        8: [
          {
            key: 'o:9',
            name: 'Annual Wellness Visit',
            due: DateTime.fromISO('2026-09-24', { zone: TZ }),
            fromToday: false,
          },
        ],
      },
      upcoming: [{ ...fixture.upcoming[0], petIds: [7] }],
    });
    renderPlanner();
    await screen.findByText(/Today.s visit · needs a plan/);
    const rest = screen.getByText('Rest of household · optional').parentElement as HTMLElement;
    expect(within(rest).getByRole('button', { name: /^Olive/ })).toBeTruthy();
    expect(within(rest).queryByRole('button', { name: /^Juno/ })).toBeNull();
    expect(within(rest).queryByText('Everyone else is booked or planned.')).toBeNull();
    // She is flagged as needing a plan (nothing booked, overdue).
    expect(
      screen.getByText(/has nothing booked and is overdue for Annual Wellness Visit/)
    ).toBeTruthy();
    expect(screen.getByText('Already on the calendar for this household')).toBeTruthy();
  });

  it('a pet already booked on a household visit can also go on a new card, and stays on its visit', async () => {
    renderPlanner();
    await screen.findByText(/Today.s visit · needs a plan/);
    // Greta is on the Dec 2 visit: no way off it here, but she can be added elsewhere.
    fireEvent.click(screen.getByRole('button', { name: 'Greta: add another visit' }));
    expect(screen.getByText(/Stays on the Dec 2 visit\. Also book Greta in/)).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: /Take off this card/ })).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: /A new follow-up card/ }));
    // Still on the Dec 2 visit, and now on the new card too.
    expect(screen.getByRole('button', { name: 'Greta: add another visit' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Greta: move or add another visit' })).toBeTruthy();
  });

  it('says the household could not load instead of "everyone else is booked"', async () => {
    vi.mocked(loadPlannerDataMock).mockResolvedValueOnce({
      ...fixture,
      pets: fixture.pets.filter((p) => p.onTodaysVisit),
      upcoming: [],
      householdError: 'Could not load the rest of the household. Close and reopen to try again.',
    });
    renderPlanner();
    await screen.findByText(/Today.s visit · needs a plan/);
    expect(screen.getByRole('alert').textContent).toContain(
      'Could not load the rest of the household'
    );
    expect(screen.queryByText('Everyone else is booked or planned.')).toBeNull();
  });
});

const HANDOFF_PREFIX = 'vayd:routing-forward-booking-handoff:';
/** What the planner left for the new tab behind `/schedule/routing?fbHandoff=<key>`. */
function handoffFor(url: string) {
  const key = new URL(url, 'http://x').searchParams.get('fbHandoff');
  expect(key).toBeTruthy();
  return JSON.parse(localStorage.getItem(HANDOFF_PREFIX + key) ?? 'null') as {
    raw?: string;
    preview?: string;
    focusVisit?: Record<string, unknown>;
  };
}

describe('Adding a pet to a visit that would run late: Send to CLs', () => {
  const PEPPER_NOTE =
    "Casey Demo suggested adding Pepper to Greta's visit (Okafor) on Wed Dec 2, 10:00 AM–12:00 PM " +
    'arrival, with Dr. Priya Patel (appt #900), but didn\'t add Pepper because a later stop could ' +
    'run late: Ruiz household may arrive 5 min past their window. Can you look into this and add ' +
    'Pepper if it can work? Pepper needs: Ear Recheck. Adds about 14 min.';

  /** Today's four pets get "No follow-up needed" so Done only waits on the visit. */
  function planTodaysPets() {
    for (const name of ['Fluffy', 'Angel', 'Marvin', 'Biscuit'])
      pick(trayPet(name), /No follow-up needed/);
    fireEvent.click(screen.getByRole('button', { name: 'Client declined' }));
  }
  const gretaCard = () => screen.getByText('Wed, Dec 2').closest('article') as HTMLElement;

  it('is offered only when the visit would make a later stop late', async () => {
    const { loadAddPetImpact } = await import('./visitImpact');
    vi.mocked(loadAddPetImpact).mockResolvedValueOnce({
      newEnd: DateTime.fromISO('2026-12-02T11:05', { zone: TZ }),
      laterStops: [],
    });
    renderPlanner();
    await screen.findByText(/Today.s visit · needs a plan/);
    pick(trayPet('Pepper'), /visit · Wed, Dec 2/);
    await screen.findByText('No other visits after this one that day.');
    expect(within(gretaCard()).getByRole('button', { name: 'Add Pepper' })).toBeTruthy();
    expect(within(gretaCard()).queryByRole('button', { name: 'Send to CLs' })).toBeNull();
    expect(within(gretaCard()).queryByRole('button', { name: 'Add anyway' })).toBeNull();
  });

  it('leaves the visit alone and makes one forward-booking row per pet at Done, with where to add it', async () => {
    renderPlanner();
    await screen.findByText(/Today.s visit · needs a plan/);
    planTodaysPets();
    pick(trayPet('Pepper'), /visit · Wed, Dec 2/);
    await screen.findByText(/5 min past their window/);
    await screen.findByText(/Adds about 14 min/);
    fireEvent.click(within(gretaCard()).getByRole('button', { name: 'Send to CLs' }));

    expect(
      within(gretaCard()).getByText(
        'Goes to the CLs when you press Done: add Pepper to this visit.'
      )
    ).toBeTruthy();
    expect(within(gretaCard()).queryByRole('button', { name: 'Add anyway' })).toBeNull();
    // Nothing on the calendar changes, and nothing is saved before Done.
    expect(actions.addPetsToUpcomingVisit).not.toHaveBeenCalled();
    expect(actions.createPlannerForwardBookings).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Done/ }));
    await waitFor(() => expect(actions.createPlannerForwardBookings).toHaveBeenCalledTimes(1));
    const call = actions.createPlannerForwardBookings.mock.calls[0][0];
    expect(call.pets.map((p: { name: string }) => p.name)).toEqual(['Pepper']);
    // The row aims at that visit's day and provider.
    expect(call.interval).toEqual({ kind: 'date', date: '2026-12-02' });
    expect(call.providerId).toBe(7);
    expect(call.typeIdFor(call.pets[0])).toBe(3);
    expect(call.serviceMinutes).toBe(14);
    expect(call.notesFor(call.pets[0])).toBe(PEPPER_NOTE);
    expect(actions.addPetsToUpcomingVisit).not.toHaveBeenCalled();
    expect(actions.undoPlannerBooking).not.toHaveBeenCalled();
  });

  it('Undo takes it back: the Add buttons return and Done waits for a choice again', async () => {
    renderPlanner();
    await screen.findByText(/Today.s visit · needs a plan/);
    planTodaysPets();
    pick(trayPet('Pepper'), /visit · Wed, Dec 2/);
    await screen.findByText(/5 min past their window/);
    fireEvent.click(within(gretaCard()).getByRole('button', { name: 'Send to CLs' }));
    fireEvent.click(within(gretaCard()).getByRole('button', { name: 'Undo' }));
    expect(screen.queryByText(/Goes to the CLs when you press Done: add Pepper/)).toBeNull();
    expect(within(gretaCard()).getByRole('button', { name: 'Add anyway' })).toBeTruthy();
    expect(within(gretaCard()).getByRole('button', { name: 'Send to CLs' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Done/ }));
    expect(await screen.findByText(/Press Add on the Dec 2 visit/)).toBeTruthy();
    expect(actions.createPlannerForwardBookings).not.toHaveBeenCalled();
  });

  it("today's pet sent to the CLs for a visit saves the forward-booking choice for that day", async () => {
    renderPlanner();
    await screen.findByText(/Today.s visit · needs a plan/);
    for (const name of ['Angel', 'Marvin', 'Biscuit']) pick(trayPet(name), /No follow-up needed/);
    fireEvent.click(screen.getByRole('button', { name: 'Client declined' }));
    pick(trayPet('Fluffy'), /visit · Wed, Dec 2/);
    await screen.findByText(/5 min past their window/);
    fireEvent.click(within(gretaCard()).getByRole('button', { name: 'Send to CLs' }));
    fireEvent.click(screen.getByRole('button', { name: /Done/ }));
    await waitFor(() => expect(actions.savePetDisposition).toHaveBeenCalledTimes(4));
    const fluffy = actions.savePetDisposition.mock.calls.find(([d]) => d.pet.name === 'Fluffy')![0];
    expect(fluffy.entryId).toBe(500);
    expect(fluffy.disposition).toMatchObject({
      mode: 'forward_book_fields',
      // Nov 3 → Dec 2.
      intervalAmount: 29,
      intervalUnit: 'days',
    });
    expect(fluffy.disposition.bookingNotes).toMatch(/^Casey Demo suggested adding Fluffy to Greta's visit \(Okafor\) on Wed Dec 2/);
  });

  it('a pet the planner was opened for: Done says it went to the CLs for that visit', async () => {
    vi.mocked(loadPlannerDataMock).mockResolvedValueOnce({
      ...fixture,
      todayProviderId: null,
      pets: fixture.pets.map((p) => ({
        ...p,
        onTodaysVisit: false,
        appointmentId: null,
        soapEncounterId: null,
        ...(p.patientId === 4 ? { focusReason: 'Labs are back', sourceAppointmentId: 104 } : {}),
      })),
    });
    const { onSaved } = renderPlanner();
    await screen.findByText('Labs are back · needs a plan');
    pick(trayPet('Biscuit'), /visit · Wed, Dec 2/);
    await screen.findByText(/5 min past their window/);
    fireEvent.click(within(gretaCard()).getByRole('button', { name: 'Send to CLs' }));
    fireEvent.click(screen.getByRole('button', { name: /Done/ }));
    await waitFor(() =>
      expect(onSaved).toHaveBeenCalledWith({
        focusSummary: 'Biscuit: sent to the CLs to add to the Dec 2 visit.',
      })
    );
    expect(actions.createPlannerForwardBookings.mock.calls[0][0].pets[0].name).toBe('Biscuit');
  });

  it('View in calendar opens that visit, with the longer end time, in a new tab', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue({} as Window);
    try {
      renderPlanner();
      await screen.findByText(/Today.s visit · needs a plan/);
      pick(trayPet('Pepper'), /visit · Wed, Dec 2/);
      await screen.findByText(/5 min past their window/);
      fireEvent.click(within(gretaCard()).getByRole('button', { name: 'View in calendar' }));
      expect(open).toHaveBeenCalledTimes(1);
      const [url, target] = open.mock.calls[0];
      expect(target).toBe('_blank');
      expect(String(url)).toMatch(/^\/schedule\/routing\?fbHandoff=/);
      const stored = handoffFor(String(url));
      expect(stored.raw).toBeUndefined();
      expect(stored.focusVisit).toEqual({
        appointmentId: 900,
        startIso: '2026-12-02T15:00:00.000Z',
        practiceDateKey: '2026-12-02',
        providerId: 7,
        label: 'Wed, Dec 2',
        previewEndIso: '2026-12-02T16:05:00.000Z',
        originalEndIso: '2026-12-02T15:45:00Z',
      });
      expect(screen.queryByText(/Embedded calendar/)).toBeNull();
      expect(screen.queryByRole('dialog', { name: 'Calendar' })).toBeNull();
    } finally {
      open.mockRestore();
    }
  });
});

describe('Best-fit slots: Review in a new tab', () => {
  const slot = {
    key: 'P7-2027-11-02-0-0',
    date: '2027-11-02',
    suggestedStartIso: '2027-11-02T14:00:00Z',
    windowStartIso: '2027-11-02T13:00:00Z',
    windowEndIso: '2027-11-02T15:00:00Z',
    doctorPimsId: 'P7',
    doctorName: 'Priya Patel',
    score: 12.5,
    addedDriveSeconds: 360,
    projectedDriveSeconds: 4800,
    emptyDay: false,
    isFallbackDoctor: false,
    dayVisitCount: 4,
    zoneName: 'Eastside',
    option: { date: '2027-11-02', suggestedStartIso: '2027-11-02T14:00:00Z', insertionIndex: 1 },
  };

  it('opens the calendar at that slot in a new tab; Book stays; a booking there updates the card', async () => {
    bestFit.searchPlannerBestFit.mockResolvedValue({
      slots: [slot],
      place: { address: '1 Elm St', lat: 43.66, lon: -70.25 },
      doctorPimsId: 'P7',
      error: null,
    });
    const tab = { location: { href: '' }, close: vi.fn() };
    const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    try {
      renderPlanner();
      await screen.findByText(/Today.s visit · needs a plan/);
      pick(trayPet('Fluffy'), /"In 1 year" card/);
      setType(cardTitled('In 1 year'), 'Fluffy', 1);
      fireEvent.click(screen.getByRole('button', { name: 'Find a time now' }));
      const panel = await screen.findByRole('dialog', { name: 'Find a time' });
      const item = (await within(panel).findAllByRole('listitem'))[0];
      expect(within(item).getByRole('button', { name: /^Book Tue, Nov 2, 2027/ })).toBeTruthy();

      fireEvent.click(
        within(item).getByRole('button', {
          name: 'Review Tue, Nov 2, 2027 with Priya Patel in the calendar',
        })
      );
      expect(open).toHaveBeenCalledWith('', '_blank');
      await waitFor(() => expect(tab.location.href).toMatch(/^\/schedule\/routing\?fbHandoff=/));
      expect(bestFit.internalDoctorIdForPims).toHaveBeenCalledWith('P7');
      const stored = handoffFor(tab.location.href);
      const preview = JSON.parse(stored.preview!);
      expect(preview).toMatchObject({
        version: 1,
        listOptionKey: slot.key,
        option: {
          date: '2027-11-02',
          suggestedStartIso: slot.suggestedStartIso,
          doctorPimsId: '7',
        },
        appointmentTypeId: 1,
        newApptMeta: { clientId: '50', address: '1 Elm St' },
        previewPatients: [{ id: 1, name: 'Fluffy' }],
      });
      // Review books nothing; the panel and the card's search stay.
      expect(bestFit.bookBestFitSlot).not.toHaveBeenCalled();
      expect(actions.removePlannerForwardBookings).not.toHaveBeenCalled();
      expect(
        within(panel).getByText(/That time is open in the calendar in another tab/)
      ).toBeTruthy();

      act(() =>
        notifyFollowUpPlannerBooked({
          appointmentId: 556,
          startIso: '2026-11-16T14:00:00Z',
          endIso: '2026-11-16T15:00:00Z',
          primaryProviderId: 7,
        })
      );
      await screen.findByText(/✓ Booked · Mon, Nov 16/);
      expect(screen.queryByRole('dialog', { name: 'Find a time' })).toBeNull();
    } finally {
      open.mockRestore();
    }
  });
});

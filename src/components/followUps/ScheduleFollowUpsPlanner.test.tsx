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
  default: () => <div>Embedded calendar</div>,
}));
vi.mock('../../api/appointmentSettings', async (orig) => ({
  ...(await orig<typeof import('../../api/appointmentSettings')>()),
  fetchAllEmployees: vi.fn(async () => [
    { id: 7, firstName: 'Priya', lastName: 'Patel', email: 'p@x.com' },
  ]),
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
    await screen.findByText('Embedded calendar');
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
    await screen.findByText('Embedded calendar');
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
    await screen.findByText('Embedded calendar');
    fireEvent.click(screen.getByRole('button', { name: 'Back to follow-ups' }));
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
    await screen.findByText('Embedded calendar');
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
    await screen.findByText('Embedded calendar');
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
    await screen.findByText('Embedded calendar');
  });
});

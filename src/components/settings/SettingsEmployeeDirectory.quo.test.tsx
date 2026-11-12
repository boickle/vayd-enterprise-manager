/**
 * COM-CALL (owner, Nov 10, 2026): the staff profile's "Quo user" field. With Quo on it's required,
 * the Quo user whose email matches is pre-selected and marked "(matches email — confirm)" (nothing
 * is saved until Save), "Doesn't use Quo" is a choice, and the Staff list marks active people with
 * neither as "Quo: not linked". Calls from a Quo user linked to nobody are called out.
 * Nov 11 follow-ups: the notice names the person (Quo name, else the deactivated staff record), is a
 * warning not an error, offers "Dismiss these calls", and staff whose login is off are marked.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import SettingsEmployeeDirectory from './SettingsEmployeeDirectory';

const people = vi.hoisted(() => [
  {
    id: 1,
    firstName: 'Pat',
    lastName: 'Manager',
    isActive: true,
    email: 'pat@vayd.test',
    openPhoneUserId: 'USpat',
  },
  { id: 2, firstName: 'Sam', lastName: 'Csr', isActive: true, email: 'Sam@Vayd.test' },
  {
    id: 3,
    firstName: 'Nora',
    lastName: 'Nophone',
    isActive: true,
    email: 'nora@vayd.test',
    doesNotUseQuo: true,
  },
]);
const saveEmployees = vi.hoisted(() => vi.fn(async () => ({})));
const dismissCalls = vi.hoisted(() => vi.fn(async () => 5));
const unlinked = vi.hoisted(() => ({
  list: [] as Array<Record<string, unknown>>,
}));

vi.mock('../../api/appointmentSettings', () => ({
  fetchAllEmployees: async () => people,
  fetchEmployee: vi.fn(async (id: number) => ({
    ...people.find((p) => p.id === id),
    practice: { id: 1 },
  })),
  fetchEmployeeRoles: async () => [],
  updateEmployeeBio: vi.fn(async () => undefined),
  updateEmployeeRoles: vi.fn(async () => undefined),
  EMPLOYEE_BIO_MAX_LENGTH: 2000,
}));
vi.mock('../../api/employeesMutations', () => ({
  deleteEmployees: vi.fn(),
  saveEmployees,
  upsertEmployees: vi.fn(),
}));
vi.mock('../../api/quoUsers', async (orig) => ({
  ...(await orig<typeof import('../../api/quoUsers')>()),
  fetchQuoUsers: async () => ({
    quoEnabled: true,
    users: [
      { id: 'USpat', name: 'Pat Manager', email: 'pat@vayd.test' },
      { id: 'USsam', name: 'Sam Csr', email: 'sam@vayd.test' },
    ],
  }),
  fetchUnlinkedQuoCallers: async () => unlinked.list,
  dismissUnlinkedQuoCalls: dismissCalls,
  fetchActiveStaffWithLoginOff: async () => [2],
}));

vi.mock('../../api/branchInventory', () => ({
  getEmployeeBranches: async () => [],
  getControlledDrugLocation: async () => null,
  setControlledDrugLocation: vi.fn(),
  listInventoryBranchLocations: async () => [],
  listPracticeBranches: async () => [],
  setEmployeeBranches: vi.fn(),
}));
vi.mock('../../api/offboarding', () => ({
  cancelOffboarding: vi.fn(),
  fetchDeactivatedStaff: async () => [],
}));
vi.mock('../../api/users', () => ({
  createStaffLogin: vi.fn(),
  getStaffLogin: async () => null,
  setStaffWorksWith: vi.fn(),
}));
vi.mock('../../permissions/PermissionContext', () => ({
  usePermissions: () => ({ can: () => true }),
}));
vi.mock('../../hooks/useOpenPhoneLineDirectory', () => ({
  displayNameForQuoLine: () => '',
  useOpenPhoneLineDirectory: () => ({ lines: [] }),
}));
vi.mock('../../utils/practiceLetterhead', () => ({
  loadProviderSignature: async () => null,
  saveProviderSignature: vi.fn(async () => undefined),
}));
vi.mock('./SettingsEmployeeAccess', () => ({ default: () => null }));
vi.mock('../ViewAsButton', () => ({ default: () => null }));
vi.mock('../SignaturePad', () => ({ default: () => null }));

const LOST = {
  quoUserId: 'USlost',
  name: 'Lost Person',
  email: 'lost@vayd.test',
  waitingCalls: 2,
  lastCallAt: null,
  inQuo: true,
};
const GONE = {
  quoUserId: 'USxjrsYYIF',
  name: null,
  email: null,
  waitingCalls: 5,
  lastCallAt: null,
  inQuo: false,
  formerStaffName: 'Winni Zhang (deactivated)',
};

/** The notice paragraph whose whole text matches (the name is in its own <strong>). */
const noticeText = (re: RegExp) =>
  screen.findByText((_, el) => el?.tagName === 'P' && re.test(el.textContent ?? ''));

beforeEach(() => {
  saveEmployees.mockClear();
  dismissCalls.mockClear();
  unlinked.list = [LOST];
});

it('marks active staff with no Quo choice as "Quo: not linked" and names the unlinked Quo caller', async () => {
  render(<SettingsEmployeeDirectory />);
  expect(
    await screen.findByRole('option', { name: /Sam Csr.* · Quo: not linked/ })
  ).toBeInTheDocument();
  expect(screen.getByRole('option', { name: /Pat Manager/ }).textContent).not.toMatch(
    /Quo: not linked/
  );
  expect(screen.getByRole('option', { name: /Nora Nophone/ }).textContent).not.toMatch(
    /Quo: not linked/
  );
  const notice = await noticeText(
    /Calls taken in Quo by Lost Person \(lost@vayd\.test\) don’t reach anyone’s call dock — 2 waiting calls\. Choose this Quo user on their staff profile/
  );
  // A warning, not an error.
  expect(notice.closest('.settings-warning-message')).not.toBeNull();
  expect(notice.closest('.settings-error-message')).toBeNull();
});

it('names a removed Quo login from the deactivated staff record, never by its raw id, and dismisses its calls', async () => {
  unlinked.list = [GONE];
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
  render(<SettingsEmployeeDirectory />);
  const notice = await noticeText(
    /Calls taken in Quo by Winni Zhang \(deactivated\) don’t reach anyone’s call dock — 5 waiting calls\. If someone now uses this Quo login/
  );
  expect(notice.textContent).not.toMatch(/USxjrsYYIF/);
  unlinked.list = [];
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss these calls' }));
  await waitFor(() => expect(dismissCalls).toHaveBeenCalledWith('USxjrsYYIF'));
  expect(confirm.mock.calls[0][0]).toMatch(/Dismiss 5 waiting calls from Winni Zhang \(deactivated\)/);
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'Dismiss these calls' })).toBeNull()
  );
  confirm.mockRestore();
});

it('describes a removed Quo login with no staff record plainly', async () => {
  unlinked.list = [{ ...GONE, formerStaffName: null }];
  render(<SettingsEmployeeDirectory />);
  expect(
    await noticeText(/Calls taken in Quo by a Quo user no longer in your Quo workspace \(USxjrsYYIF\)/)
  ).toBeInTheDocument();
});

it('does not dismiss when the confirm is cancelled', async () => {
  unlinked.list = [GONE];
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  render(<SettingsEmployeeDirectory />);
  fireEvent.click(await screen.findByRole('button', { name: 'Dismiss these calls' }));
  expect(dismissCalls).not.toHaveBeenCalled();
  confirm.mockRestore();
});

it('marks active staff whose login is off as "Login off — offboard?"', async () => {
  render(<SettingsEmployeeDirectory />);
  expect(
    await screen.findByRole('option', { name: /Sam Csr · Login off — offboard\?/ })
  ).toBeInTheDocument();
  expect(screen.getByRole('option', { name: /Pat Manager/ }).textContent).not.toMatch(/Login off/);
  expect(await screen.findByText(/Login off for 1 active person/)).toBeInTheDocument();
});

it('pre-selects the Quo user whose email matches, marked to confirm, and saves it only on Save', async () => {
  render(<SettingsEmployeeDirectory selectedEmployeeId={2} section="profile" />);
  const field = (await screen.findByRole('combobox', { name: 'Quo user' })) as HTMLSelectElement;
  await waitFor(() => expect(field.value).toBe('USsam'));
  expect(
    screen.getByRole('option', { name: /Sam Csr · sam@vayd\.test \(matches email — confirm\)/ })
  ).toBeInTheDocument();
  expect(field).toBeRequired();
  expect(saveEmployees).not.toHaveBeenCalled();

  fireEvent.submit(field.closest('form') as HTMLFormElement);
  await waitFor(() => expect(saveEmployees).toHaveBeenCalled());
  expect((saveEmployees.mock.calls[0] as unknown[])[0]).toMatchObject({
    id: 2,
    quoUserChoice: 'USsam',
  });
});

it('refuses to save with no Quo choice, and "Doesn’t use Quo" saves as none', async () => {
  const onMessage = vi.fn();
  render(
    <SettingsEmployeeDirectory selectedEmployeeId={2} section="profile" onMessage={onMessage} />
  );
  const field = (await screen.findByRole('combobox', { name: 'Quo user' })) as HTMLSelectElement;
  await waitFor(() => expect(field.value).toBe('USsam'));

  fireEvent.change(field, { target: { value: '' } });
  fireEvent.submit(field.closest('form') as HTMLFormElement);
  await waitFor(() =>
    expect(onMessage).toHaveBeenCalledWith(
      expect.stringMatching(/Choose this person’s Quo user/),
      'error'
    )
  );
  expect(saveEmployees).not.toHaveBeenCalled();

  fireEvent.change(field, { target: { value: 'none' } });
  expect(screen.getByRole('option', { name: 'Doesn’t use Quo' })).toBeInTheDocument();
  fireEvent.submit(field.closest('form') as HTMLFormElement);
  await waitFor(() => expect(saveEmployees).toHaveBeenCalled());
  expect((saveEmployees.mock.calls[0] as unknown[])[0]).toMatchObject({
    id: 2,
    quoUserChoice: 'none',
  });
});

it('shows the saved choice without a suggestion', async () => {
  render(<SettingsEmployeeDirectory selectedEmployeeId={3} section="profile" />);
  const field = (await screen.findByRole('combobox', { name: 'Quo user' })) as HTMLSelectElement;
  await waitFor(() => expect(field.value).toBe('none'));
  expect(screen.queryByText(/matches email — confirm/)).toBeNull();
});

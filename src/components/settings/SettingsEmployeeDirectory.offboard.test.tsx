/**
 * RP-03-11 (frontend component): Settings → Staff hides deactivated people by default. "Show
 * deactivated (N)" lists them, labelled "(Deactivated)". The Roles page half of RP-03-11 belongs to
 * SettingsScoutRoles (RP-04, another batch).
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import SettingsEmployeeDirectory from './SettingsEmployeeDirectory';

vi.mock('../../api/appointmentSettings', () => ({
  fetchAllEmployees: async () => [
    { id: 1, firstName: 'Pat', lastName: 'Manager', isActive: true },
    { id: 2, firstName: 'Wren', lastName: 'Doctor', isActive: true, isProvider: true },
  ],
  fetchEmployee: vi.fn(),
  fetchEmployeeRoles: async () => [],
  updateEmployeeBio: vi.fn(),
  updateEmployeeRoles: vi.fn(),
  EMPLOYEE_BIO_MAX_LENGTH: 2000,
}));
vi.mock('../../api/employeesMutations', () => ({
  deleteEmployees: vi.fn(),
  saveEmployees: vi.fn(),
  upsertEmployees: vi.fn(),
}));
vi.mock('../../api/branchInventory', () => ({
  getEmployeeBranches: async () => [],
  getControlledDrugLocation: async () => null,
  setControlledDrugLocation: vi.fn(),
  listInventoryBranchLocations: async () => [],
  listPracticeBranches: async () => [],
  setEmployeeBranches: vi.fn(),
}));
const recordLastDay = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('../../api/offboarding', () => ({
  cancelOffboarding: vi.fn(),
  recordLastDay,
  fetchDeactivatedStaff: async () => [
    {
      id: 4,
      firstName: 'Lena',
      lastName: 'Left',
      title: null,
      designation: 'DVM',
      isProvider: true,
      isActive: false,
      lastDay: null,
      lastVisit: '2026-10-09',
    },
    {
      id: 3,
      firstName: 'Tamsin',
      lastName: 'Tech',
      title: null,
      designation: null,
      isProvider: false,
      isActive: false,
      lastDay: '2026-10-31',
    },
  ],
}));
vi.mock('../../api/users', () => ({
  createStaffLogin: vi.fn(),
  getStaffLogin: async () => null,
  setStaffWorksWith: vi.fn(),
}));
const perms = vi.hoisted(() => ({ only: null as null | string[] }));
vi.mock('../../permissions/PermissionContext', () => ({
  usePermissions: () => ({ can: (key: string) => (perms.only ? perms.only.includes(key) : true) }),
}));
vi.mock('../../hooks/useOpenPhoneLineDirectory', () => ({
  displayNameForQuoLine: () => '',
  useOpenPhoneLineDirectory: () => ({ lines: [] }),
}));
vi.mock('../../utils/practiceLetterhead', () => ({
  loadProviderSignature: async () => null,
  saveProviderSignature: vi.fn(),
}));
vi.mock('./SettingsEmployeeAccess', () => ({ default: () => null }));
vi.mock('../ViewAsButton', () => ({ default: () => null }));
vi.mock('../SignaturePad', () => ({ default: () => null }));

it('RP-03-11 hides the deactivated technician until "Show deactivated" is ticked, then labels them', async () => {
  render(<SettingsEmployeeDirectory />);

  const toggle = await screen.findByRole('checkbox', { name: 'Show deactivated (2)' });
  expect(await screen.findByRole('option', { name: /Pat Manager/ })).toBeInTheDocument();
  expect(screen.queryByRole('option', { name: /Tamsin Tech/ })).toBeNull();

  fireEvent.click(toggle);
  expect(
    await screen.findByRole('option', { name: 'Tamsin Tech (Deactivated)' })
  ).toBeInTheDocument();
  expect(screen.getByRole('option', { name: /Pat Manager/ }).textContent).not.toMatch(
    /Deactivated/
  );
});

it('RPV-5 the Medical Director (license only) sees just the Access tab', async () => {
  perms.only = ['staff.license.manage'];
  try {
    render(<SettingsEmployeeDirectory selectedEmployeeId={2} section="profile" />);
    const tabs = await screen.findAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Access']);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
  } finally {
    perms.only = null;
  }
});


it('a doctor deactivated without a last day: Settings suggests their last visit and saves it as the last day', async () => {
  render(<SettingsEmployeeDirectory selectedEmployeeId={4} section="profile" />);

  const input = (await screen.findByLabelText('Last day')) as HTMLInputElement;
  expect(input.value).toBe('2026-10-09');
  expect(screen.getByText(/Not recorded\. Goals end at their last visit/)).toBeInTheDocument();

  fireEvent.change(input, { target: { value: '2026-10-14' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save last day' }));
  await waitFor(() => expect(recordLastDay).toHaveBeenCalledWith(4, '2026-10-14'));
});

/**
 * RP-04: the Roles page hides deactivated people behind "Show deactivated (N)" and labels them
 * "(Deactivated)"; the bottom of each role lists who was added or removed, linking to the audit log.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';
import SettingsScoutRoles from './SettingsScoutRoles';

vi.mock('../../api/appointmentSettings', () => ({
  fetchEmployeeRoles: async () => [
    { id: 7, name: 'Client Liaison', slug: 'client_liaison', isBranchSpecific: false },
  ],
  fetchAllEmployees: async () => [
    { id: 2, firstName: 'Sam', lastName: 'Tech', isActive: true },
    { id: 3, firstName: 'Dee', lastName: 'Gone', isActive: false },
  ],
  fetchScoutRoleAssignments: async () => ({
    role: { id: 7, name: 'Client Liaison', slug: 'client_liaison', isBranchSpecific: false },
    assignments: [
      { id: 1, employeeId: 2, branchId: null, employeeName: 'Sam Tech', branchName: null, isActive: true },
      { id: 2, employeeId: 3, branchId: null, employeeName: 'Dee Gone', branchName: null, isActive: false },
    ],
  }),
  fetchRoleManualBookingAppointmentTypes: async () => [],
  replaceScoutRoleAssignments: vi.fn(),
  createScoutEmployeeRole: vi.fn(),
  patchScoutEmployeeRole: vi.fn(),
  updateRoleManualBookingAppointmentTypes: vi.fn(),
}));
vi.mock('../../api/branchInventory', () => ({ listPracticeBranches: async () => [] }));
vi.mock('./RolePermissionsEditor', () => ({ default: () => null }));
vi.mock('../../api/permissions', async (orig) => {
  const actual = await orig<typeof import('../../api/permissions')>();
  return {
    ...actual,
    fetchPermissionAudit: async () => [
      {
        id: 21,
        permissionKey: 'staff.role.assign',
        employeeId: 1,
        employeeName: 'Pat Manager',
        entityType: 'employee',
        entityId: 2,
        detail: {
          before: [],
          after: [{ roleId: 7, slug: 'client_liaison', name: 'Client Liaison', branchId: null, office: null }],
        },
        created: '2026-11-08T10:00:00Z',
      },
      {
        id: 22,
        permissionKey: 'staff.role.assign',
        employeeId: 1,
        employeeName: 'Pat Manager',
        entityType: 'employee',
        entityId: 3,
        detail: {
          before: [{ roleId: 7, slug: 'client_liaison', name: 'Client Liaison', branchId: null, office: null }],
          after: [],
        },
        created: '2026-11-08T11:00:00Z',
      },
      {
        // A different role: must not show on this role.
        id: 23,
        permissionKey: 'staff.role.assign',
        employeeId: 1,
        employeeName: 'Pat Manager',
        entityType: 'employee',
        entityId: 2,
        detail: {
          before: [],
          after: [{ roleId: 99, slug: 'technician', name: 'Technician', branchId: null, office: null }],
        },
        created: '2026-11-08T12:00:00Z',
      },
    ],
  };
});

it('hides deactivated assignees until "Show deactivated (N)" is ticked, then labels them', async () => {
  render(<SettingsScoutRoles practiceId={1} appointmentTypes={[]} />, { wrapper: MemoryRouter });

  await screen.findByRole('checkbox', { name: /Sam Tech/ });
  expect(screen.queryByRole('checkbox', { name: /Dee Gone/ })).toBeNull();

  fireEvent.click(await screen.findByRole('checkbox', { name: 'Show deactivated (1)' }));
  expect(await screen.findByText('Dee Gone (Deactivated)')).toBeInTheDocument();
  expect(screen.getByRole('checkbox', { name: /Dee Gone \(Deactivated\)/ })).toBeChecked();

  fireEvent.click(screen.getByRole('checkbox', { name: 'Show deactivated (1)' }));
  expect(screen.queryByRole('checkbox', { name: /Dee Gone/ })).toBeNull();
});

it('lists who was added to and removed from this role, with a link to the audit log', async () => {
  render(<SettingsScoutRoles practiceId={1} appointmentTypes={[]} />, { wrapper: MemoryRouter });
  const card = await screen.findByTestId('recent-role-changes');
  expect(card).toHaveTextContent('Sam Tech was added to this role');
  expect(card).toHaveTextContent('Dee Gone was removed from this role');
  expect(card).not.toHaveTextContent('Technician');
  expect(card.querySelector('a')).toHaveAttribute('href', '/schedule/settings?tab=permission-audit');
});

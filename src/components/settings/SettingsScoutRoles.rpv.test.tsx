/**
 * RPV-6 (Nov 9, 2026): adding a role and editing a role's name, slug and office setting need "Edit the
 * role definitions" (Practice Admin). A Practice Manager sees the role and its people, not those controls
 * (the API refused them anyway).
 */
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';

const state = vi.hoisted(() => ({ keys: new Set<string>() }));
vi.mock('../../permissions/PermissionContext', () => ({
  useCan: (key: string) => state.keys.has(key),
  usePermissions: () => ({ effective: {}, can: (key: string) => state.keys.has(key) }),
}));
vi.mock('../../api/appointmentSettings', () => ({
  fetchEmployeeRoles: async () => [{ id: 7, name: 'Client Liaison', slug: 'client_liaison', isBranchSpecific: false }],
  fetchAllEmployees: async () => [{ id: 1, firstName: 'Lou', lastName: 'Bennett', isActive: true }],
  fetchScoutRoleAssignments: async () => ({
    role: { id: 7, name: 'Client Liaison', slug: 'client_liaison', isBranchSpecific: false },
    assignments: [],
  }),
  fetchRoleManualBookingAppointmentTypes: async () => [],
  replaceScoutRoleAssignments: vi.fn(),
  createScoutEmployeeRole: vi.fn(),
  patchScoutEmployeeRole: vi.fn(),
  updateRoleManualBookingAppointmentTypes: vi.fn(),
}));
vi.mock('../../api/branchInventory', () => ({ listPracticeBranches: async () => [] }));
vi.mock('./RolePermissionsEditor', () => ({ default: () => null }));

import SettingsScoutRoles from './SettingsScoutRoles';

const renderRoles = () => render(<SettingsScoutRoles practiceId={1} appointmentTypes={[]} />);

it('Practice Manager: no Add and no Save role, but Save assignees', async () => {
  state.keys = new Set(['staff.role.assign', 'role.manual_booking.manage']);
  renderRoles();
  expect(await screen.findByText('Who has Client Liaison?')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save assignees' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Add' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Save role' })).toBeNull();
  expect(screen.queryByText('Slug')).toBeNull();
});

it('Practice Admin: Add and Save role', async () => {
  state.keys = new Set(['staff.role.assign', 'role.definition.manage']);
  renderRoles();
  expect(await screen.findByRole('button', { name: 'Save role' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
});

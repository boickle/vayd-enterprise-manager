/**
 * RP-04-6 / RP-A8-1: your own Access tab is locked (license radios and grant controls disabled, with a
 * hint), someone else's is not; the license hint names a practice admin or the medical director; and the
 * "recent changes" list at the bottom shows role, license and grant changes with a link to the audit log.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import SettingsEmployeeAccess from './SettingsEmployeeAccess';

const state = vi.hoisted(() => ({ myEmployeeId: 5, platform: false, canLicense: true }));

vi.mock('../../utils/practiceIdFromToken', () => ({ currentPracticeId: () => 1 }));
vi.mock('../../permissions/PermissionContext', () => ({
  usePermissions: () => ({
    reload: () => {},
    effective: {
      employeeId: state.myEmployeeId,
      isPlatformAdmin: state.platform,
      permissions: { 'staff.license.manage': 'all', 'staff.permission.grant': 'all' },
    },
    can: (key: string) => (key === 'staff.license.manage' ? state.canLicense : true),
  }),
}));
vi.mock('../../api/permissions', async (orig) => {
  const actual = await orig<typeof import('../../api/permissions')>();
  return {
    ...actual,
    fetchEmployeePermissions: async () => ({
      effective: {
        employeeId: 5,
        roles: ['technician'],
        isLicensed: false,
        licenseType: null,
        isPlatformAdmin: false,
        permissions: {},
        sources: {},
      },
      grants: [
        {
          id: 1,
          permissionKey: 'invoice.void',
          scope: 'all',
          reason: 'cover',
          grantedByName: 'Pat',
          expiresAt: null,
          created: '2026-11-01T00:00:00Z',
        },
      ],
    }),
    fetchPermissionCatalog: async () => ({
      sections: { billing: 'Billing' },
      roleSlugs: [],
      entries: [
        { key: 'invoice.void', section: 'billing', label: 'Void invoices', grantable: true, roles: {}, reason: true, requiresLicense: null, unbuilt: false, note: null },
        { key: 'invoice.discount', section: 'billing', label: 'Discount invoices', grantable: true, roles: {}, reason: true, requiresLicense: null, unbuilt: false, note: null },
      ],
    }),
    fetchPermissionAudit: async () => [
      {
        id: 11,
        permissionKey: 'staff.role.assign',
        employeeId: 2,
        employeeName: 'Pat Manager',
        entityType: 'employee',
        entityId: 5,
        detail: {
          before: [],
          after: [{ roleId: 9, slug: 'client_liaison', name: 'Client Liaison', branchId: null, office: null }],
        },
        created: '2026-11-08T10:00:00Z',
      },
      {
        id: 12,
        permissionKey: 'staff.license.manage',
        employeeId: 3,
        employeeName: 'Dr Director',
        entityType: 'employee',
        entityId: 5,
        detail: {
          before: { isLicensed: false, licenseType: null },
          after: { isLicensed: true, licenseType: 'technician' },
        },
        created: '2026-11-08T11:00:00Z',
      },
    ],
  };
});

describe('SettingsEmployeeAccess own-tab lock (RP-04-6)', () => {
  it('disables license radios and grant controls on your own tab and says who to ask', async () => {
    state.myEmployeeId = 5;
    state.platform = false;
    render(<SettingsEmployeeAccess employeeId={5} />);
    await screen.findByText('License');

    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled();
    expect(screen.getByRole('combobox')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Grant' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeDisabled();
    expect(screen.getAllByText(/Ask a practice admin to change your own access/).length).toBeGreaterThan(0);
  });

  it('leaves the controls on for someone else, and for a platform superadmin on their own tab', async () => {
    state.myEmployeeId = 9;
    const { unmount } = render(<SettingsEmployeeAccess employeeId={5} />);
    await screen.findByText('License');
    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeEnabled();
    expect(screen.queryByText(/Ask a practice admin to change your own access/)).toBeNull();
    unmount();

    state.myEmployeeId = 5;
    state.platform = true;
    render(<SettingsEmployeeAccess employeeId={5} />);
    await screen.findByText('License');
    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeEnabled();
    state.platform = false;
  });
});

describe('SettingsEmployeeAccess wording (RP-A8-1)', () => {
  it('names a practice admin or the medical director as who sets a license', async () => {
    state.myEmployeeId = 9;
    state.canLicense = false;
    const { container } = render(<SettingsEmployeeAccess employeeId={5} />);
    await screen.findByText('License');
    const gate = container.querySelector('.perm-blocked');
    expect(gate).toHaveAttribute(
      'title',
      "Only a practice admin or the medical director can set someone's license"
    );
    state.canLicense = true;
  });
});

describe('SettingsEmployeeAccess recent changes', () => {
  it('lists role and license changes at the bottom and links to the audit log', async () => {
    state.myEmployeeId = 9;
    render(<SettingsEmployeeAccess employeeId={5} />);
    const card = await screen.findByTestId('recent-access-changes');
    expect(card).toHaveTextContent('Roles: added Client Liaison');
    expect(card).toHaveTextContent('Pat Manager');
    expect(card).toHaveTextContent('License: not licensed → technician');
    await waitFor(() =>
      expect(card.querySelector('a')).toHaveAttribute('href', '/schedule/settings?tab=permission-audit')
    );
  });
});

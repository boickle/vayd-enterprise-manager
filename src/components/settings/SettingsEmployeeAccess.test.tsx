/**
 * RP-04-6 / RP-A8-1: your own Access tab is locked (license radios and grant controls disabled, with a
 * hint), someone else's is not; the license hint names a practice admin or the medical director; and the
 * "recent changes" list at the bottom shows role, license and grant changes with a link to the audit log.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, vi } from 'vitest';
import SettingsEmployeeAccess from './SettingsEmployeeAccess';

const DEFAULT_GRANTS = [
  {
    id: 1,
    permissionKey: 'invoice.void',
    scope: 'all',
    reason: 'cover',
    grantedByName: 'Pat',
    expiresAt: null,
    created: '2026-11-01T00:00:00Z',
  },
];

const state = vi.hoisted(() => ({
  myEmployeeId: 5,
  platform: false,
  canLicense: true,
  grants: [] as Array<Record<string, unknown>>,
  addCalls: [] as Array<{ permissionKey: string; reason: string; expiresAt?: string | null }>,
}));

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
    addEmployeePermissionGrant: async (
      _practiceId: number,
      _employeeId: number,
      body: { permissionKey: string; reason: string; expiresAt?: string | null },
    ) => {
      state.addCalls.push(body);
      state.grants = [
        ...state.grants,
        {
          id: 100 + state.addCalls.length,
          permissionKey: body.permissionKey,
          scope: 'all',
          reason: body.reason,
          grantedByName: 'Me',
          expiresAt: body.expiresAt ?? null,
          created: '2026-11-09T00:00:00Z',
        },
      ];
      return {};
    },
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
      grants: state.grants,
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

beforeEach(() => {
  state.grants = DEFAULT_GRANTS.map((g) => ({ ...g }));
  state.addCalls = [];
});

describe('SettingsEmployeeAccess own-tab lock (RP-04-6)', () => {
  it('disables license radios and grant controls on your own tab and says who to ask', async () => {
    state.myEmployeeId = 5;
    state.platform = false;
    render(<SettingsEmployeeAccess employeeId={5} />, { wrapper: MemoryRouter });
    await screen.findByText('License');

    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled();
    expect(screen.getByRole('combobox')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Grant' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeDisabled();
    expect(screen.getAllByText(/Ask a practice admin to change your own access/).length).toBeGreaterThan(0);
  });

  it('leaves the controls on for someone else, and for a platform superadmin on their own tab', async () => {
    state.myEmployeeId = 9;
    const { unmount } = render(<SettingsEmployeeAccess employeeId={5} />, {
      wrapper: MemoryRouter,
    });
    await screen.findByText('License');
    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeEnabled();
    expect(screen.queryByText(/Ask a practice admin to change your own access/)).toBeNull();
    unmount();

    state.myEmployeeId = 5;
    state.platform = true;
    render(<SettingsEmployeeAccess employeeId={5} />, { wrapper: MemoryRouter });
    await screen.findByText('License');
    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeEnabled();
    state.platform = false;
  });
});

describe('SettingsEmployeeAccess wording (RP-A8-1)', () => {
  it('names a practice admin or the medical director as who sets a license', async () => {
    state.myEmployeeId = 9;
    state.canLicense = false;
    const { container } = render(<SettingsEmployeeAccess employeeId={5} />, {
      wrapper: MemoryRouter,
    });
    await screen.findByText('License');
    const gate = container.querySelector('.perm-blocked');
    expect(gate).toHaveAttribute(
      'title',
      "Only a practice admin or the medical director can set someone's license"
    );
    state.canLicense = true;
  });

  it('describes signing and prescription directions the way EMR-07 and EMR-07b allow', async () => {
    state.myEmployeeId = 9;
    const { container } = render(<SettingsEmployeeAccess employeeId={5} />, {
      wrapper: MemoryRouter,
    });
    await screen.findByText('License');
    const intro = container.querySelector('.settings-card .settings-card-subtitle');
    expect(intro).toHaveTextContent(
      'Signing a SOAP needs a veterinary license. A licensed technician may sign quick visits and medical notes, and may enter prescription directions for the vet. No role or grant substitutes for a license.'
    );
    expect(intro).not.toHaveTextContent('Prescriptions and refill authorizations additionally');
    expect(intro).not.toHaveTextContent('no role or grant substitutes for either');
  });
});

describe('SettingsEmployeeAccess grant end date (RP-A4-1)', () => {
  /** Picks a permission and an end day, then confirms the grant with a reason. */
  async function grantUntil(day: string) {
    const { container } = render(<SettingsEmployeeAccess employeeId={5} />, {
      wrapper: MemoryRouter,
    });
    await screen.findByText('License');
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'invoice.discount' } });
    fireEvent.change(container.querySelector('input[type="date"]') as HTMLInputElement, {
      target: { value: day },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Grant' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByPlaceholderText('Reason'), {
      target: { value: 'Covering the front desk' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Grant' }));
    await waitFor(() => expect(state.addCalls).toHaveLength(1));
    return container;
  }

  it('saves the last instant of a daylight-time day in Eastern (July 15 ends 23:59:59.999 EDT)', async () => {
    state.myEmployeeId = 9;
    const container = await grantUntil('2026-07-15');

    expect(state.addCalls[0].expiresAt).toBe('2026-07-15T23:59:59.999-04:00');
    expect(new Date(state.addCalls[0].expiresAt as string).toISOString()).toBe(
      '2026-07-16T03:59:59.999Z'
    );
    await waitFor(() => expect(container).toHaveTextContent('ends 7/15/2026'));
  });

  it('saves the last instant of a standard-time day in Eastern (Nov 30 ends 23:59:59.999 EST)', async () => {
    state.myEmployeeId = 9;
    const container = await grantUntil('2026-11-30');

    expect(state.addCalls[0].expiresAt).toBe('2026-11-30T23:59:59.999-05:00');
    expect(new Date(state.addCalls[0].expiresAt as string).toISOString()).toBe(
      '2026-12-01T04:59:59.999Z'
    );
    await waitFor(() => expect(container).toHaveTextContent('ends 11/30/2026'));
  });

  it('shows a stored end date as the Eastern day it was picked for, not the UTC day', async () => {
    state.myEmployeeId = 9;
    state.grants = [
      { ...DEFAULT_GRANTS[0], expiresAt: '2026-11-30T23:59:59.999-05:00' },
      {
        ...DEFAULT_GRANTS[0],
        id: 2,
        permissionKey: 'invoice.discount',
        expiresAt: '2026-07-16T03:59:59.999Z',
      },
    ];
    const { container } = render(<SettingsEmployeeAccess employeeId={5} />, {
      wrapper: MemoryRouter,
    });
    await screen.findByText('License');
    expect(container).toHaveTextContent('ends 11/30/2026');
    expect(container).toHaveTextContent('ends 7/15/2026');
    expect(container).not.toHaveTextContent('ends 7/16/2026');
  });
});

describe('SettingsEmployeeAccess recent changes', () => {
  it('lists role and license changes at the bottom and links to the audit log', async () => {
    state.myEmployeeId = 9;
    render(<SettingsEmployeeAccess employeeId={5} />, { wrapper: MemoryRouter });
    const card = await screen.findByTestId('recent-access-changes');
    expect(card).toHaveTextContent('Roles: added Client Liaison');
    expect(card).toHaveTextContent('Pat Manager');
    expect(card).toHaveTextContent('License: not licensed → technician');
    await waitFor(() =>
      expect(card.querySelector('a')).toHaveAttribute('href', '/schedule/settings?tab=permission-audit')
    );
  });
});

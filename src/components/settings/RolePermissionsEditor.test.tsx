// RP-A7-1: the role editor flags catalog keys the server does not enforce yet.
import { render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../permissions/PermissionContext', () => ({
  useCan: () => true,
  usePermissions: () => ({ reload: vi.fn() }),
}));

vi.mock('../../api/permissions', async (importActual) => {
  const actual = await importActual<typeof import('../../api/permissions')>();
  const entry = (key: string, label: string, enforced: boolean) => ({
    key,
    section: 'invoicing',
    label,
    roles: {},
    reason: false,
    requiresLicense: null,
    grantable: true,
    unbuilt: false,
    enforced,
    note: null,
  });
  return {
    ...actual,
    fetchPermissionCatalog: async () => ({
      sections: { invoicing: 'Invoicing' },
      roleSlugs: [],
      entries: [
        entry('invoice.void', 'Void invoices', true),
        entry('invoice.date.change', 'Change invoice date', false),
      ],
    }),
    fetchRolePermissions: async () => ({ defaults: {}, overrides: {} }),
    saveRolePermissionOverrides: vi.fn(),
  };
});

import RolePermissionsEditor from './RolePermissionsEditor';

describe('RolePermissionsEditor (RP-A7-1)', () => {
  it('shows "Not enforced yet" on an unenforced key only', async () => {
    render(
      <RolePermissionsEditor
        practiceId={1}
        role={{ id: 5, name: 'Technician', slug: 'technician' }}
      />
    );
    const enforcedRow = (await screen.findByText('Void invoices')).closest(
      '.perm-editor-row'
    ) as HTMLElement;
    const unenforcedRow = (await screen.findByText('Change invoice date')).closest(
      '.perm-editor-row'
    ) as HTMLElement;
    await waitFor(() => expect(within(unenforcedRow).getByText('Not enforced yet')).toBeTruthy());
    expect(within(enforcedRow).queryByText('Not enforced yet')).toBeNull();
    expect(screen.getAllByText('Not enforced yet')).toHaveLength(1);
  });
});

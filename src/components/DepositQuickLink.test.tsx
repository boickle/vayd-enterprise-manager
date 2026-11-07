/**
 * Wave 8 (bug 8d): the "Create deposit" link in the left menu shows only to people who may create a
 * deposit. Before, it showed to anyone with schedule analytics, so a plain client liaison reached a
 * page that wouldn't open, and field staff with deposit.create but no analytics never saw it.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';

const granted = new Set<string>();
let loginRole = 'employee';
vi.mock('../permissions/PermissionContext', () => ({
  useCan: (key: string) => granted.has(key),
  useScope: () => 'none',
  usePermissions: () => ({ effective: {}, can: (k: string) => granted.has(k) }),
  PermissionProvider: ({ children }: { children: unknown }) => children,
}));
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ role: loginRole }) }));

import DepositQuickLink from './DepositQuickLink';

afterEach(() => {
  granted.clear();
  loginRole = 'employee';
});

function renderLink() {
  return render(
    <MemoryRouter>
      <DepositQuickLink collapsed={false} />
    </MemoryRouter>,
  );
}

describe('Create deposit link', () => {
  it('is hidden from a client liaison without deposit.create', () => {
    renderLink();
    expect(screen.queryByRole('link', { name: /create deposit/i })).toBeNull();
  });

  it('shows to anyone with deposit.create, such as a technician carrying checks', () => {
    granted.add('deposit.create');
    renderLink();
    expect(screen.getByRole('link', { name: /create deposit/i }).getAttribute('href')).toBe('/schedule/deposits');
  });

  it('shows to an admin login, which the server lets through every staff permission', () => {
    loginRole = 'admin';
    renderLink();
    expect(screen.getByRole('link', { name: /create deposit/i })).toBeTruthy();
  });
});

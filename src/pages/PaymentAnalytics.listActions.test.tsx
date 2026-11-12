/** W9A: All payments / View payments show only for staff with report.square_reconciliation. */
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';

const granted = new Set<string>();
let loginRole: string | undefined;
vi.mock('../permissions/PermissionContext', () => ({
  useCan: (key: string) => granted.has(key),
  useScope: () => 'none',
  usePermissions: () => ({}),
  PermissionProvider: ({ children }: { children: unknown }) => children,
}));
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ role: loginRole }) }));

import { PaymentsListActions } from './PaymentAnalytics';

afterEach(() => {
  granted.clear();
  loginRole = undefined;
});

it('a client liaison or any role without report.square_reconciliation sees neither button', () => {
  render(<PaymentsListActions onAll={() => undefined} onView={() => undefined} />);
  expect(screen.queryByRole('button', { name: /all payments/i })).toBeNull();
  expect(screen.queryByRole('button', { name: /view payments/i })).toBeNull();
});

it('a practice manager, billing or the observer sees both buttons', () => {
  granted.add('report.square_reconciliation');
  render(<PaymentsListActions onAll={() => undefined} onView={() => undefined} />);
  expect(screen.getByRole('button', { name: /all payments/i })).toBeTruthy();
  expect(screen.getByRole('button', { name: /view payments/i })).toBeTruthy();
});

it('an admin login sees both buttons', () => {
  loginRole = 'admin';
  render(<PaymentsListActions onAll={() => undefined} onView={() => undefined} />);
  expect(screen.getByRole('button', { name: /all payments/i })).toBeTruthy();
});

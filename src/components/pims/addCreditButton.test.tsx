/** EMR-A3-3: "Add credit" (manual account credit) shows only for staff with account_credit.post. */
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';

const granted = new Set<string>();
vi.mock('../../permissions/PermissionContext', () => ({
  useCan: (key: string) => granted.has(key),
  useScope: () => 'none',
  usePermissions: () => ({}),
  PermissionProvider: ({ children }: { children: unknown }) => children,
}));

import { AddCreditButton } from './ClientFinancialWorkspace';

afterEach(() => granted.clear());

it('EMR-A3-3 a technician (no account_credit.post) does not see Add credit', () => {
  render(<AddCreditButton onClick={() => undefined} />);
  expect(screen.queryByRole('button', { name: /add credit/i })).toBeNull();
});

it('EMR-A3-3b billing (account_credit.post) sees Add credit', () => {
  granted.add('account_credit.post');
  render(<AddCreditButton onClick={() => undefined} />);
  expect(screen.getByRole('button', { name: /add credit/i })).toBeTruthy();
});

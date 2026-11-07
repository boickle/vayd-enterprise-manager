/** Void on an eVet invoice shows only for staff with invoice.void (managers, billing, lead CL). */
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';

const granted = new Set<string>();
vi.mock('../../permissions/PermissionContext', () => ({
  useCan: (key: string) => granted.has(key),
  useScope: () => 'none',
  usePermissions: () => ({}),
  PermissionProvider: ({ children }: { children: unknown }) => children,
}));

import { EvetVoidButton } from './ClientFinancialWorkspace';

afterEach(() => granted.clear());

it('a role without invoice.void (technician, vet, observer) does not see Void on an eVet invoice', () => {
  render(<EvetVoidButton onClick={() => undefined} />);
  expect(screen.queryByRole('button', { name: /^void$/i })).toBeNull();
});

it('a role with invoice.void (manager, billing, lead CL) sees Void and it works', () => {
  granted.add('invoice.void');
  const onClick = vi.fn();
  render(<EvetVoidButton onClick={onClick} />);
  screen.getByRole('button', { name: /^void$/i }).click();
  expect(onClick).toHaveBeenCalled();
});

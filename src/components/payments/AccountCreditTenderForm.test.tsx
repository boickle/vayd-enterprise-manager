/**
 * PAY-06-9: the checkout's "Account credit" option shows what the client can spend, defaults to the
 * smaller of credit and due, and can't take more. Used by VisitCheckoutPanel and the billing workspace.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

const granted = new Set<string>(['payment.take']);
vi.mock('../../permissions/PermissionContext', () => ({
  useCan: (key: string) => granted.has(key),
  useScope: () => 'none',
  usePermissions: () => ({}),
  PermissionProvider: ({ children }: { children: unknown }) => children,
}));

const fetchAvailableAccountCredit = vi.fn();
const addVisitTender = vi.fn();
vi.mock('../../api/visitWorkflow', () => ({
  fetchAvailableAccountCredit: (...args: unknown[]) => fetchAvailableAccountCredit(...args),
  addVisitTender: (...args: unknown[]) => addVisitTender(...args),
}));

import AccountCreditTenderForm from './AccountCreditTenderForm';

const seventy = { scout: 20, evet: 50, evetHeld: false, evetHeldAmount: 0, total: 70, heldNote: null };

beforeEach(() => {
  fetchAvailableAccountCredit.mockReset();
  addVisitTender.mockReset();
  granted.clear();
  granted.add('payment.take');
});

it('PAY-06-9: shows "$70.00 available", defaults to the smaller of credit and due, and applies it', async () => {
  fetchAvailableAccountCredit.mockResolvedValue(seventy);
  addVisitTender.mockResolvedValue({ id: 'inv-1' });
  const onApplied = vi.fn();
  render(<AccountCreditTenderForm invoiceId="inv-1" clientId={42} due={120} onApplied={onApplied} />);

  expect(await screen.findByText(/\$70\.00 available/)).toBeTruthy();
  expect(screen.getByText(/Account credit:/)).toBeTruthy();
  expect(fetchAvailableAccountCredit).toHaveBeenCalledWith(42);
  const input = screen.getByLabelText('Account credit amount') as HTMLInputElement;
  expect(input.value).toBe('70.00');

  fireEvent.click(screen.getByRole('button', { name: /apply credit/i }));
  await waitFor(() => expect(addVisitTender).toHaveBeenCalledTimes(1));
  expect(addVisitTender).toHaveBeenCalledWith('inv-1', expect.objectContaining({ method: 'account_credit', amount: 70 }));
  await waitFor(() => expect(onApplied).toHaveBeenCalledWith({ id: 'inv-1' }, 70, 0));
});

it('PAY-06-9: defaults to what is due when that is smaller, and can’t type more', async () => {
  fetchAvailableAccountCredit.mockResolvedValue(seventy);
  render(<AccountCreditTenderForm invoiceId="inv-2" clientId={42} due={30} onApplied={vi.fn()} />);
  const input = (await screen.findByLabelText('Account credit amount')) as HTMLInputElement;
  expect(input.value).toBe('30.00');
  fireEvent.change(input, { target: { value: '95' } });
  expect(input.value).toBe('30.00');
  fireEvent.change(input, { target: { value: '12.5' } });
  expect(input.value).toBe('12.5');
});

it('PAY-06-9: says when eVet credit is held because eVet sync is on', async () => {
  fetchAvailableAccountCredit.mockResolvedValue({
    scout: 20, evet: 0, evetHeld: true, evetHeldAmount: 50, total: 20, heldNote: 'held',
  });
  render(<AccountCreditTenderForm invoiceId="inv-3" clientId={42} due={120} onApplied={vi.fn()} />);
  expect(await screen.findByText(/\$20\.00 available/)).toBeTruthy();
  expect(screen.getByRole('note').textContent).toMatch(/\$50\.00 eVet credit is held until eVet sync is turned off/);
  expect((screen.getByLabelText('Account credit amount') as HTMLInputElement).value).toBe('20.00');
});

it('PAY-06-9: hidden for staff who can’t take payments', () => {
  granted.clear();
  const { container } = render(
    <AccountCreditTenderForm invoiceId="inv-4" clientId={42} due={120} onApplied={vi.fn()} />,
  );
  expect(container.textContent).toBe('');
  expect(fetchAvailableAccountCredit).not.toHaveBeenCalled();
});

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

let confirmAnswer = true;
const confirmSeen: Array<{ title?: string; message: string }> = [];
vi.mock('../../utils/appDialog', () => ({
  appConfirm: async (o: { title?: string; message: string }) => {
    confirmSeen.push(o);
    return confirmAnswer;
  },
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
  expect(fetchAvailableAccountCredit).toHaveBeenCalledWith(42, 'inv-1');
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

describe('Appointment deposits (D7 option 3)', () => {
  const ownDeposit = {
    ...seventy,
    scout: 100,
    evet: 0,
    total: 100,
    depositHeld: 0,
    deposits: [
      { invoiceId: 'dep-1', appointmentId: 7, amount: 100, held: true, forThisBill: true, label: "Deposit for Biscuit's visit on Nov 20" },
    ],
  };
  const otherDeposit = {
    ...seventy,
    scout: 0,
    evet: 0,
    total: 0,
    depositHeld: 100,
    deposits: [
      { invoiceId: 'dep-2', appointmentId: 8, amount: 100, held: true, forThisBill: false, label: "Deposit for Pippin's visit on Nov 21" },
    ],
  };

  it("PAY-A17-9: this visit's deposit is included and named", async () => {
    fetchAvailableAccountCredit.mockResolvedValue(ownDeposit);
    render(<AccountCreditTenderForm invoiceId="inv-9" clientId={42} due={150} onApplied={vi.fn()} />);
    expect(await screen.findByText(/\$100\.00 available/)).toBeTruthy();
    expect(screen.getByTestId('credit-own-deposit').textContent).toBe(
      "Includes the deposit for Biscuit's visit on Nov 20 ($100.00), used first."
    );
    expect(screen.queryByTestId('credit-use-held-deposit')).toBeNull();
  });

  it('PAY-A17-10: a deposit for another visit is left out until ticked, then needs a confirm', async () => {
    fetchAvailableAccountCredit.mockResolvedValue(otherDeposit);
    addVisitTender.mockResolvedValue({ id: 'inv-10' });
    const onApplied = vi.fn();
    render(<AccountCreditTenderForm invoiceId="inv-10" clientId={42} due={75} onApplied={onApplied} />);
    expect(await screen.findByText(/\$0\.00 available/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /apply credit/i })).toBeNull();
    fireEvent.click(screen.getByTestId('credit-use-held-deposit'));
    expect(screen.getByText(/\$100\.00 available/)).toBeTruthy();
    expect((screen.getByLabelText('Account credit amount') as HTMLInputElement).value).toBe('75.00');
    confirmAnswer = false;
    fireEvent.click(screen.getByRole('button', { name: /apply credit/i }));
    await waitFor(() => expect(confirmSeen).toHaveLength(1));
    expect(confirmSeen[0]).toMatchObject({ title: 'Use a deposit for another visit?' });
    expect(confirmSeen[0].message).toContain("This is the deposit for Pippin's visit on Nov 21 ($100.00).");
    expect(addVisitTender).not.toHaveBeenCalled();
    confirmAnswer = true;
    fireEvent.click(screen.getByRole('button', { name: /apply credit/i }));
    await waitFor(() => expect(addVisitTender).toHaveBeenCalledTimes(1));
    expect(addVisitTender).toHaveBeenCalledWith(
      'inv-10',
      expect.objectContaining({ method: 'account_credit', amount: 75, useHeldDeposits: true })
    );
  });
});

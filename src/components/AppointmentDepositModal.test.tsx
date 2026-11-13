/**
 * Appointment deposit window (owner, Nov 12, 2026): ask for $100, send it by text or email pay
 * link, or take it in person on the deposit bill.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

const api = vi.hoisted(() => ({
  getAppointmentDeposit: vi.fn(),
  requestAppointmentDeposit: vi.fn(),
  createDepositPayLink: vi.fn(),
}));
vi.mock('../api/appointmentDeposits', () => api);
vi.mock('../api/clientSms', () => ({ sendClientSms: vi.fn().mockResolvedValue({}) }));
vi.mock('./ClientEmailComposeModal', () => ({
  ClientEmailComposeModal: (p: { open: boolean; initialBodyText: string }) =>
    p.open ? <div data-testid="email-compose">{p.initialBodyText}</div> : null,
}));
vi.mock('./ClientSmsComposeModal', () => ({
  ClientSmsComposeModal: (p: { open: boolean; message: string }) =>
    p.open ? <div data-testid="sms-compose">{p.message}</div> : null,
}));

import { AppointmentDepositModal } from './AppointmentDepositModal';

const base = {
  appointmentId: 7,
  clientId: 3,
  patientId: 5,
  petName: 'Bella',
  appointmentStart: '2026-11-20T15:00:00.000Z',
  scoutInvoiceNumber: 900,
  label: "Deposit for Bella's visit on Nov 20",
};
const none = { ...base, invoiceId: null, requested: 0, paid: 0, owed: 0, creditLeft: 0, status: 'none' };
const asked = { ...base, invoiceId: 'dep-1', requested: 100, paid: 0, owed: 100, creditLeft: 0, status: 'requested' };

function open(props: Partial<Parameters<typeof AppointmentDepositModal>[0]> = {}) {
  const onTakePayment = vi.fn();
  render(
    <AppointmentDepositModal
      appointmentId={7}
      clientId={3}
      clientName="Wren Fairweather"
      onClose={() => undefined}
      onTakePayment={onTakePayment}
      {...props}
    />,
  );
  return { onTakePayment };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Appointment deposit window', () => {
  it('starts at $100, asks for it, and opens a text with the deposit pay link', async () => {
    api.getAppointmentDeposit.mockResolvedValue(none);
    api.requestAppointmentDeposit.mockResolvedValue(asked);
    api.createDepositPayLink.mockResolvedValue({ url: 'https://pay.test/abc', amount: 100, label: asked.label, invoiceId: 'dep-1' });
    open();
    await screen.findByText(asked.label);
    expect((screen.getByTestId('appointment-deposit-amount') as HTMLInputElement).value).toBe('100');
    fireEvent.click(screen.getByRole('button', { name: 'Text pay link' }));
    const sms = await screen.findByTestId('sms-compose');
    expect(api.requestAppointmentDeposit).toHaveBeenCalledWith(7, 100);
    expect(sms.textContent).toContain('$100.00 deposit');
    expect(sms.textContent).toContain('https://pay.test/abc');
    expect(sms.textContent).toMatch(/^Hi Wren,/);
  });

  it('emails the link for what is still owed, without asking again when the amount is unchanged', async () => {
    api.getAppointmentDeposit.mockResolvedValue({ ...asked, paid: 40, owed: 60, creditLeft: 40, status: 'part_paid' });
    api.createDepositPayLink.mockResolvedValue({ url: 'https://pay.test/def', amount: 60, label: asked.label, invoiceId: 'dep-1' });
    open();
    expect(await screen.findByTestId('appointment-deposit-status')).toHaveTextContent('$60.00 still to collect');
    fireEvent.click(screen.getByRole('button', { name: 'Email pay link' }));
    const email = await screen.findByTestId('email-compose');
    expect(email.textContent).toContain('$60.00 deposit');
    expect(api.requestAppointmentDeposit).not.toHaveBeenCalled();
  });

  it('Take payment now opens the deposit bill', async () => {
    api.getAppointmentDeposit.mockResolvedValue(none);
    api.requestAppointmentDeposit.mockResolvedValue(asked);
    const { onTakePayment } = open();
    await screen.findByText(asked.label);
    fireEvent.change(screen.getByTestId('appointment-deposit-amount'), { target: { value: '150' } });
    fireEvent.click(screen.getByRole('button', { name: 'Take payment now' }));
    await waitFor(() => expect(onTakePayment).toHaveBeenCalledWith('dep-1'));
    expect(api.requestAppointmentDeposit).toHaveBeenCalledWith(7, 150);
  });

  it('a paid deposit offers nothing to send, and texting is off for a client who gets no texts', async () => {
    api.getAppointmentDeposit.mockResolvedValue({ ...asked, paid: 100, owed: 0, creditLeft: 100, status: 'paid' });
    open({ doNotSms: true, depositRequiredNote: 'Two unpaid visits' });
    expect(await screen.findByTestId('appointment-deposit-status')).toHaveTextContent('Paid.');
    expect(screen.getByRole('note')).toHaveTextContent('Deposit required: Two unpaid visits');
    expect(screen.getByRole('button', { name: 'Text pay link' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Email pay link' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Take payment now' })).toBeDisabled();
  });
});

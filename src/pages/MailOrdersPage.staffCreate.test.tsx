/** New mail order (package mail): a package can go to someone who isn't a client, typed in "Send to". */
import { fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';

vi.mock('../api/onlineStore', () => ({}));
vi.mock('../api/clientsStaff', () => ({ searchClientsStaff: vi.fn(async () => []) }));

import { StaffCreate } from './MailOrdersPage';

const addButton = () => screen.getByRole('button', { name: 'Add to queue' }) as HTMLButtonElement;

it('with no client, Add to queue needs a Send to name and the package info', () => {
  render(<StaffCreate practiceId={1} createdByEmployeeId={7} onClose={vi.fn()} onCreate={vi.fn(async () => {})} />);
  expect(addButton().disabled).toBe(true);
  fireEvent.change(screen.getByPlaceholderText(/Ashes/), { target: { value: 'Ashes – cedar urn for Biscuit' } });
  expect(addButton().disabled).toBe(true);
  fireEvent.change(screen.getByTestId('new-mail-send-to'), { target: { value: '   ' } });
  expect(addButton().disabled).toBe(true);
  fireEvent.change(screen.getByTestId('new-mail-send-to'), { target: { value: ' Jenna Rivera ' } });
  expect(addButton().disabled).toBe(false);
});

it('a no-client package is sent with the typed name, no client and no address yet', () => {
  const onCreate = vi.fn(async () => {});
  render(<StaffCreate practiceId={1} createdByEmployeeId={7} onClose={vi.fn()} onCreate={onCreate} />);
  fireEvent.change(screen.getByTestId('new-mail-send-to'), { target: { value: ' Jenna Rivera ' } });
  fireEvent.change(screen.getByPlaceholderText(/Ashes/), { target: { value: 'Ashes – cedar urn for Biscuit' } });
  fireEvent.click(addButton());
  expect(onCreate).toHaveBeenCalledWith(
    expect.objectContaining({
      origin: 'staff_mail',
      packageShipment: true,
      customerName: 'Jenna Rivera',
      clientId: null,
      patientId: null,
      ship: { name: 'Jenna Rivera' },
      lines: [{ name: 'Ashes – cedar urn for Biscuit', quantity: 1 }],
    }),
  );
});

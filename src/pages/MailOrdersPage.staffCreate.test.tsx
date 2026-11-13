/** New mail order (package mail): ashes and other packages, to a client or anyone else, from an office or a typed address. */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

vi.mock('../api/onlineStore', () => ({}));
vi.mock('../api/clientsStaff', () => ({ searchClientsStaff: vi.fn(async () => []) }));
vi.mock('../api/branchInventory', () => ({
  listInventoryBranchLocations: vi.fn(async () => []),
  listPracticeBranches: vi.fn(async () => [
    { id: 3, name: 'Raleigh office', isActive: true, isDefault: true },
    { id: 5, name: 'Brunswick office', isActive: true, isDefault: false },
  ]),
}));
vi.mock('../api/practiceSettings', async (orig) => ({
  ...(await orig<typeof import('../api/practiceSettings')>()),
  getPracticeSettings: vi.fn(async () => ({ 'inventory.onlineStoreFulfillmentBranchId': '5' })),
}));

import { StaffCreate } from './MailOrdersPage';

const addButton = () => screen.getByRole('button', { name: 'Add to queue' }) as HTMLButtonElement;
const fillNoClient = () => {
  fireEvent.change(screen.getByTestId('new-mail-send-to'), { target: { value: ' Jenna Rivera ' } });
  fireEvent.change(screen.getByPlaceholderText(/Ashes/), { target: { value: 'Ashes – cedar urn for Pepper' } });
};

it('with no client, Add to queue needs a Send to name and the package info', async () => {
  render(<StaffCreate practiceId={1} createdByEmployeeId={7} onClose={vi.fn()} onCreate={vi.fn(async () => {})} />);
  await waitFor(() => expect((screen.getByTestId('new-mail-ship-from') as HTMLSelectElement).value).toBe('5'));
  expect(addButton().disabled).toBe(true);
  fireEvent.change(screen.getByPlaceholderText(/Ashes/), { target: { value: 'Ashes – cedar urn for Pepper' } });
  expect(addButton().disabled).toBe(true);
  fireEvent.change(screen.getByTestId('new-mail-send-to'), { target: { value: '   ' } });
  expect(addButton().disabled).toBe(true);
  fireEvent.change(screen.getByTestId('new-mail-send-to'), { target: { value: ' Jenna Rivera ' } });
  expect(addButton().disabled).toBe(false);
});

it('ships from the store fulfillment office by default, or another office', async () => {
  const onCreate = vi.fn(async () => {});
  render(<StaffCreate practiceId={1} createdByEmployeeId={7} onClose={vi.fn()} onCreate={onCreate} />);
  await waitFor(() => expect((screen.getByTestId('new-mail-ship-from') as HTMLSelectElement).value).toBe('5'));
  fillNoClient();
  fireEvent.change(screen.getByTestId('new-mail-ship-from'), { target: { value: '3' } });
  fireEvent.click(addButton());
  expect(onCreate).toHaveBeenCalledWith(
    expect.objectContaining({
      packageShipment: true,
      customerName: 'Jenna Rivera',
      clientId: null,
      ship: { name: 'Jenna Rivera' },
      fillBranchId: 3,
      lines: [{ name: 'Ashes – cedar urn for Pepper', quantity: 1 }],
    }),
  );
  expect(onCreate.mock.calls[0][0]).not.toHaveProperty('shipFrom');
});

it('Another address needs a full address, then sends it instead of an office', async () => {
  const onCreate = vi.fn(async () => {});
  render(<StaffCreate practiceId={1} createdByEmployeeId={7} onClose={vi.fn()} onCreate={onCreate} />);
  await waitFor(() => expect((screen.getByTestId('new-mail-ship-from') as HTMLSelectElement).value).toBe('5'));
  fillNoClient();
  fireEvent.change(screen.getByTestId('new-mail-ship-from'), { target: { value: 'other' } });
  expect(addButton().disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('Ship from street'), { target: { value: '9 Harbor Rd' } });
  fireEvent.change(screen.getByLabelText('Ship from city'), { target: { value: 'Freeport' } });
  fireEvent.change(screen.getByLabelText('Ship from state'), { target: { value: 'me' } });
  expect(addButton().disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('Ship from ZIP'), { target: { value: '04032' } });
  expect(addButton().disabled).toBe(false);
  fireEvent.click(addButton());
  const body = onCreate.mock.calls[0][0] as Record<string, unknown>;
  expect(body.shipFrom).toEqual({ line1: '9 Harbor Rd', city: 'Freeport', state: 'ME', postal: '04032' });
  expect(body).not.toHaveProperty('fillBranchId');
});

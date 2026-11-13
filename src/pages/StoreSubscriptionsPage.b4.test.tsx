/**
 * B4 (owner, Nov 7, 2026): only managers change what a client pays. The mail order team's Edit auto-ship window shows
 * the item and quantity locked, with a note on what to do when they look wrong; managers can change them.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';

const { can } = vi.hoisted(() => ({ can: { money: false } }));

vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ token: '' }) }));
vi.mock('../permissions/useCanOrAdminLogin', () => ({ useCanOrAdminLogin: (key: string) => (key === 'store.autoship.money' ? can.money : true) }));
vi.mock('./store/AutoshipCardPanel', () => ({ default: () => null }));
vi.mock('../api/autoshipCard', () => ({ listStaffAutoshipCards: vi.fn(), setStaffAutoshipCard: vi.fn() }));
vi.mock('../api/onlineStore', () => ({
  listOnlineStoreItems: vi.fn().mockResolvedValue([]),
  refreshMailNavCounts: vi.fn(),
  listStoreSubscriptions: vi.fn().mockResolvedValue([
    {
      id: 1, itemName: 'Joint support chews (60 ct)', inventoryItemId: 1, quantity: 1, unitPrice: 36, frequency: 'monthly',
      renewalDate: '2026-12-01', fulfillmentKind: null, active: true, paused: false, stripeSubscriptionId: 'sub_1', customerName: 'Maria Rivera',
    },
  ]),
  patchStoreSubscription: vi.fn(),
}));

import StoreSubscriptionsPage from './StoreSubscriptionsPage';

async function openEdit() {
  render(
    <MemoryRouter>
      <StoreSubscriptionsPage />
    </MemoryRouter>,
  );
  await screen.findByText('Joint support chews (60 ct)');
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  await screen.findByText('Edit auto-ship');
}

describe('B4: who can change an auto-ship item and quantity', () => {
  it('B4-1: a mail order team member sees Item and Qty locked, with the note', async () => {
    can.money = false;
    await openEdit();
    expect((screen.getByLabelText('Item') as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByLabelText('Qty') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText('Frequency') as HTMLSelectElement).disabled).toBe(false);
    expect(screen.getByTestId('autoship-locked-note').textContent).toMatch(/Re-send/);
  });

  it('B4-2: a manager can change Item and Qty, and sees no note', async () => {
    can.money = true;
    await openEdit();
    expect((screen.getByLabelText('Item') as HTMLSelectElement).disabled).toBe(false);
    expect((screen.getByLabelText('Qty') as HTMLInputElement).disabled).toBe(false);
    expect(screen.queryByTestId('autoship-locked-note')).toBeNull();
  });
});

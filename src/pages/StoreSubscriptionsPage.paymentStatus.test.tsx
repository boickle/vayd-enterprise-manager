import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';

vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ token: '' }) }));
vi.mock('./store/AutoshipCardPanel', () => ({ default: () => null }));
vi.mock('../api/autoshipCard', () => ({ listStaffAutoshipCards: vi.fn(), setStaffAutoshipCard: vi.fn() }));
vi.mock('../api/onlineStore', () => ({
  listOnlineStoreItems: vi.fn().mockResolvedValue([]),
  refreshMailNavCounts: vi.fn(),
  listStoreSubscriptions: vi.fn(),
  patchStoreSubscription: vi.fn(),
}));

import StoreSubscriptionsPage from './StoreSubscriptionsPage';
import { listStoreSubscriptions } from '../api/onlineStore';

function row(id: number, extra: Record<string, unknown>) {
  return {
    id,
    itemName: `Item ${id}`,
    inventoryItemId: id,
    quantity: 1,
    unitPrice: 10,
    frequency: 'monthly',
    renewalDate: '2026-12-01',
    fulfillmentKind: null,
    active: true,
    paused: false,
    stripeSubscriptionId: `sub_${id}`,
    customerName: `Client ${id}`,
    ...extra,
  };
}

async function renderPage() {
  (listStoreSubscriptions as ReturnType<typeof vi.fn>).mockResolvedValue([
    row(1, {}),
    row(2, { paymentStatus: 'failing' }),
    row(3, { active: false, paymentStatus: 'ended' }),
    row(4, { paymentStatus: 'cancel_pending' }),
  ]);
  render(
    <MemoryRouter>
      <StoreSubscriptionsPage />
    </MemoryRouter>,
  );
  await screen.findByText('Item 1');
}

describe('StoreSubscriptionsPage payment status (OS-10)', () => {
  it('shows "Payment failing" on a failing row', async () => {
    await renderPage();
    expect(screen.getAllByText('Payment failing')).toHaveLength(1);
    expect(screen.getByText('Item 2')).toBeTruthy();
  });

  it('keeps ended rows reachable: "Payment problems" and "All" show them, labelled "Ended: card failed"', async () => {
    await renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Payment problems' }));
    await waitFor(() => expect(screen.getByText('Item 3')).toBeTruthy());
    expect(screen.getByText('Item 2')).toBeTruthy();
    expect(screen.queryByText('Item 1')).toBeNull();
    expect(screen.getByText('Ended: card failed')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    await waitFor(() => expect(screen.getByText('Item 1')).toBeTruthy());
    expect(screen.getByText('Item 3')).toBeTruthy();
  });

  it('OS-A2: shows "Cancel pending: Stripe not confirmed" on a cancel_pending row only', async () => {
    await renderPage();
    expect(screen.getAllByText('Cancel pending: Stripe not confirmed')).toHaveLength(1);
    expect(screen.getAllByText('Payment failing')).toHaveLength(1);
  });
});

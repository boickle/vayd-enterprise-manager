import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';

vi.mock('../../api/onlineStore', async (orig) => ({
  ...(await orig<typeof import('../../api/onlineStore')>()),
  listMyAutoship: vi.fn(),
  patchMyAutoship: vi.fn(),
}));
vi.mock('../../api/autoshipCard', () => ({ listMyAutoshipCards: vi.fn(), setMyAutoshipCard: vi.fn() }));
vi.mock('../store/AutoshipCardPanel', () => ({ default: () => <div>card panel</div> }));

import AutoshipManageModal from './AutoshipManageModal';
import { listMyAutoship } from '../../api/onlineStore';

function sub(paymentStatus: 'failing' | null) {
  return {
    id: 5,
    itemName: 'Heartgard',
    inventoryItemId: 9,
    quantity: 1,
    unitPrice: 20,
    frequency: 'monthly',
    renewalDate: '2026-12-01',
    fulfillmentKind: null,
    patientId: 3,
    active: true,
    paused: false,
    stripeSubscriptionId: 'sub_5',
    paymentStatus,
  };
}

function show() {
  render(
    <MemoryRouter>
      <AutoshipManageModal
        pet={{ name: 'Rex', dbId: 3 } as never}
        rx={{ name: 'Heartgard', inventoryItemId: 9 } as never}
        practiceId={1}
        onClose={() => undefined}
        onOrderNow={() => undefined}
      />
    </MemoryRouter>,
  );
}

describe('AutoshipManageModal payment failing (OS-10)', () => {
  it('shows the failing note with an update-card action', async () => {
    (listMyAutoship as ReturnType<typeof vi.fn>).mockResolvedValue([sub('failing')]);
    show();
    expect(await screen.findByText(/Payment failing: update your card/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: /update card/i })[0]);
    await waitFor(() => expect(screen.getByText('card panel')).toBeTruthy());
  });

  it('shows no failing note on a normal auto-ship', async () => {
    (listMyAutoship as ReturnType<typeof vi.fn>).mockResolvedValue([sub(null)]);
    show();
    await screen.findAllByText(/Next shipment/);
    expect(screen.queryByText(/Payment failing/)).toBeNull();
  });
});

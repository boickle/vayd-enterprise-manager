import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';

vi.mock('../../api/onlineStore', async (orig) => ({
  ...(await orig<typeof import('../../api/onlineStore')>()),
  myStoreCards: vi.fn().mockResolvedValue({
    hasCard: true,
    cards: [{ paymentMethodId: 'pm_1', brand: 'visa', last4: '4242' }],
  }),
  myStoreCheckout: vi.fn(),
  publicCheckout: vi.fn(),
}));
vi.mock('./StoreCartCardEntry', () => ({ default: () => null }));

import { StoreGiftCardCheckout } from './StoreGiftCardCart';
import { myStoreCheckout, StoreRequestError } from '../../api/onlineStore';

const checkout = myStoreCheckout as ReturnType<typeof vi.fn>;

describe('StoreGiftCardCheckout attemptKey (OS-03)', () => {
  it('reuses the key after no answer and changes it after a 4xx', async () => {
    checkout
      .mockRejectedValueOnce(new StoreRequestError('no answer', null))
      .mockRejectedValueOnce(new StoreRequestError('declined', 402))
      .mockRejectedValueOnce(new StoreRequestError('declined', 402));
    render(
      <MemoryRouter>
        <StoreGiftCardCheckout
          practiceId={1}
          clientId={7}
          prefill={{ name: 'Ann', email: 'a@b.co' }}
          lines={[{ key: 'k', listingId: '1', name: 'Gift', amount: 50, price: 50, quantity: 1, sendToSelf: true, recipientName: '' } as never]}
        />
      </MemoryRouter>,
    );
    const btn = async () => screen.findByRole('button', { name: /^Pay \$/ });
    for (let n = 1; n <= 3; n++) {
      // wait for the saved card to load so the saved-card path is used
      await waitFor(() => expect(screen.queryByText(/4242/)).toBeTruthy());
      fireEvent.click(await btn());
      await waitFor(() => expect(checkout).toHaveBeenCalledTimes(n));
      await waitFor(() => expect((screen.getByRole('button', { name: /^Pay \$/ }) as HTMLButtonElement).disabled).toBe(false));
      await screen.findByText(n === 1 ? 'no answer' : 'declined');
    }
    const keys = checkout.mock.calls.map((c) => c[0].attemptKey);
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[0]);
  });
});

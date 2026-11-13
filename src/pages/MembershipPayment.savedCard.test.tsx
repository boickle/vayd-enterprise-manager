import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

// PAY-C7-1: the portal membership signup offers the card on file.
const createPaymentMethod = vi.fn();
vi.mock('@stripe/stripe-js', () => ({
  loadStripe: vi.fn().mockResolvedValue({
    elements: () => ({ create: () => ({ mount: () => undefined, destroy: () => undefined, unmount: () => undefined }) }),
    createPaymentMethod: (...args: unknown[]) => createPaymentMethod(...args),
    confirmCardPayment: vi.fn(),
  }),
}));
vi.mock('react-router', () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ state: undefined }),
}));
vi.mock('../auth/useAuth', () => ({
  useAuth: () => ({ userEmail: 'ada@example.com', userId: 3, role: ['client'] }),
}));
vi.mock('../api/clientPortal', () => ({
  fetchClientInfo: vi.fn().mockResolvedValue({ firstName: 'Ada', lastName: 'Lovelace' }),
}));
vi.mock('../api/practicePublicConfig', () => ({ loadStripePublishableKey: vi.fn().mockResolvedValue('pk_test_x') }));
vi.mock('../utils/analytics', () => ({ trackPurchase: vi.fn() }));
vi.mock('../api/onlineStore', async (orig) => ({
  ...(await orig<typeof import('../api/onlineStore')>()),
  myStoreCards: vi.fn(),
}));
vi.mock('../api/payments', async (orig) => ({
  ...(await orig<typeof import('../api/payments')>()),
  createPayment: vi.fn(),
  confirmMembershipPayment: vi.fn(),
}));

import MembershipPayment from './MembershipPayment';
import { myStoreCards } from '../api/onlineStore';
import { createPayment, PaymentIntent } from '../api/payments';

const cards = myStoreCards as ReturnType<typeof vi.fn>;
const pay = createPayment as ReturnType<typeof vi.fn>;

const initialState = {
  petId: '7',
  petName: 'Rex',
  amountCents: 5900,
  currency: 'USD',
  intent: PaymentIntent.SUBSCRIPTION,
  subscriptionPlanId: 'prod_x',
  subscriptionPlanVariationId: 'price_x',
  customerEmail: 'ada@example.com',
  customerName: 'Ada Lovelace',
};

function setup() {
  render(<MembershipPayment fromModal initialState={initialState as never} />);
}

describe('PAY-C7-1 membership signup offers the saved card', () => {
  beforeEach(() => {
    cards.mockReset();
    pay.mockReset();
    createPaymentMethod.mockReset();
    pay.mockResolvedValue({ success: true, status: 'ACTIVE', providerPaymentId: 'pi_1' });
  });

  it('chooses the card on file by default and sends it with no new card', async () => {
    cards.mockResolvedValue({
      hasCard: true,
      cards: [
        { paymentMethodId: 'pm_other', brand: 'amex', last4: '0005' },
        { paymentMethodId: 'pm_visa', brand: 'visa', last4: '4242', recommended: true },
      ],
    });
    setup();
    const saved = (await screen.findByLabelText('Use Visa ending 4242')) as HTMLInputElement;
    expect(saved.checked).toBe(true);
    expect((screen.getByLabelText('Enter a new card') as HTMLInputElement).checked).toBe(false);
    // No cardholder or address to type for a saved card.
    expect(screen.queryByPlaceholderText('Full name on card')).toBeNull();

    fireEvent.click(await screen.findByRole('button', { name: 'Pay & Enroll' }));
    await waitFor(() => expect(pay).toHaveBeenCalledTimes(1));
    expect(pay.mock.calls[0][0]).toMatchObject({ provider: 'stripe', sourceId: 'pm_visa' });
    expect(createPaymentMethod).not.toHaveBeenCalled();
  });

  it('offers "Enter a new card" and then asks for the card details', async () => {
    cards.mockResolvedValue({
      hasCard: true,
      cards: [{ paymentMethodId: 'pm_visa', brand: 'visa', last4: '4242', recommended: true }],
    });
    setup();
    fireEvent.click(await screen.findByLabelText('Enter a new card'));
    expect(await screen.findByPlaceholderText('Full name on card')).toBeTruthy();
    expect((screen.getByLabelText('Use Visa ending 4242') as HTMLInputElement).checked).toBe(false);
  });

  it('shows no choice when the client has no card on file', async () => {
    cards.mockResolvedValue({ hasCard: false, cards: [] });
    setup();
    expect(await screen.findByPlaceholderText('Full name on card')).toBeTruthy();
    await waitFor(() => expect(cards).toHaveBeenCalled());
    expect(screen.queryByLabelText('Enter a new card')).toBeNull();
  });
});

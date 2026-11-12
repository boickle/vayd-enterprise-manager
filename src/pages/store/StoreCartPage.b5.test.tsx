/**
 * B5 (owner, Nov 7, 2026): a logged-in client can't place the order before her name and email have loaded, and a
 * "fill this in" message clears itself once the thing it asked for is there.
 */
import { forwardRef } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi, type Mock } from 'vitest';

const { mockHttp, authState } = vi.hoisted(() => ({
  mockHttp: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
  authState: { current: {} as Record<string, unknown> },
}));

vi.mock('../../api/http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/http')>()),
  http: mockHttp,
}));

vi.mock('../../api/onlineStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/onlineStore')>()),
  // Catalog calls go through a separate axios client; they don't touch households.
  publicStoreProducts: vi.fn().mockResolvedValue([]),
  publicStoreTax: vi.fn().mockResolvedValue({ name: 'Sales Tax', rate: 0, level2Rate: 0, level3Rate: 0 }),
  publicStoreFulfillment: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../api/practices', () => ({ loadHostPractice: vi.fn().mockResolvedValue(undefined) }));

const { details } = vi.hoisted(() => ({ details: { release: null as null | (() => void) } }));
vi.mock('../../api/clientPortal', () => ({
  // B5: the client's details arrive only when the test releases them.
  fetchClientInfo: vi.fn().mockImplementation(
    () =>
      new Promise((resolve) => {
        details.release = () => resolve({ firstName: 'Ann', lastName: 'Able', email: 'a@vayd.test' });
      }),
  ),
  fetchClientPets: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../auth/useAuth', () => ({ useAuth: () => authState.current }));

vi.mock('./StoreCartCardEntry', () => ({
  default: forwardRef(function FakeCardEntry({ canSaveCard = true }: { canSaveCard?: boolean }) {
    return (
      <div data-testid="new-card-entry" data-can-save={String(canSaveCard)}>
        Enter a card
      </div>
    );
  }),
}));

vi.mock('../../components/AddressAutocomplete', () => ({
  AddressAutocomplete: () => <div data-testid="address-autocomplete" />,
}));

import StoreCartPage from './StoreCartPage';

const CARD_A = { paymentMethodId: 'pm_a1', brand: 'visa', last4: '4242', expMonth: 12, expYear: 2030, recommended: true };

function storeLine() {
  return {
    inventoryItemId: 11,
    name: 'Store item',
    quantity: 1,
    unitPrice: 40,
    autoshipFrequency: null,
    recommendedFrequency: null,
  };
}

function giftLine() {
  return {
    key: 'g1',
    listingId: 'gc-1',
    name: 'Gift card',
    amount: 50,
    price: 50,
    quantity: 1,
    sendToSelf: true,
    recipientName: '',
    recipientEmail: '',
    message: '',
    deliverAt: '',
  };
}

/** Every URL the page asked the API for (GET and POST). */
function requestedUrls(): string[] {
  return [...mockHttp.get.mock.calls, ...mockHttp.post.mock.calls].map((call) => String(call[0]));
}

function renderCart() {
  return render(
    <MemoryRouter initialEntries={['/store/cart']}>
      <StoreCartPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  for (const fn of Object.values(mockHttp)) (fn as Mock).mockReset();
  mockHttp.get.mockImplementation(async (url: string) => {
    if (url === '/store/checkout/cards') {
      return { data: { hasCard: true, brand: 'visa', last4: '4242', cards: [CARD_A] } };
    }
    if (url === '/store/checkout/account') return { data: { available: 0, owed: 0, invoices: [] } };
    return { data: [] };
  });
  mockHttp.post.mockImplementation(async (url: string) => {
    if (url.includes('card-on-file')) {
      // What the old page got back for any typed email: someone's saved card.
      return { data: { hasCard: true, cards: [{ ...CARD_A, paymentMethodId: 'pm_someone_else', last4: '1111' }] } };
    }
    return { data: {} };
  });
});


describe('B5: Place order waits for the client details', () => {
  it('B5-1: logged in, Place order is disabled until the details load, then enabled', async () => {
    authState.current = { token: 'token-a', userId: '101', clientInfo: { firstName: 'Ann', lastName: 'Able', email: 'a@vayd.test' } };
    localStorage.setItem('vayd_store_cart', JSON.stringify([storeLine()]));
    renderCart();
    const place = await screen.findByRole('button', { name: /Place order/ });
    expect((place as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      details.release?.();
    });
    await waitFor(() => expect((screen.getByRole('button', { name: /Place order/ }) as HTMLButtonElement).disabled).toBe(false));
  });

  it('B5-2: a guest with no name gets the message, and it clears once the name and email are typed', async () => {
    authState.current = { token: null, userId: null, clientInfo: null };
    localStorage.setItem('vayd_store_gift_cart', JSON.stringify([giftLine()]));
    localStorage.setItem('vayd_store_cart', JSON.stringify([storeLine()]));
    renderCart();
    const place = await screen.findByRole('button', { name: /Place order|Pay/ });
    await act(async () => {
      fireEvent.click(place);
    });
    await screen.findByText('Enter the name and email for this order.');
    await act(async () => {
      fireEvent.change(screen.getAllByLabelText('Name')[0], { target: { value: 'Gail Guest' } });
      fireEvent.change(screen.getAllByLabelText('Email')[0], { target: { value: 'gail@example.com' } });
    });
    await waitFor(() => expect(screen.queryByText('Enter the name and email for this order.')).toBeNull());
  });
});

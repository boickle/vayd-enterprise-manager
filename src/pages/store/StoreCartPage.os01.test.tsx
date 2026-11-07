/**
 * OS-01 frontend component tests (docs/test-plans/online-store.md in vayd-api, D1).
 *
 *   OS-01-9   Cart page hides cards from guests: no card request for a typed email; only card entry shown.
 *             D1 update (Nov 7, 2026): guests buy gift cards only; a store item asks for the login.
 *   OS-01-10  A logged-in client sees its own cards (from the login), and editing the email changes nothing.
 *
 * Every HTTP call the page makes goes through the mocked `http` client, so the tests see each request.
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

vi.mock('../../api/clientPortal', () => ({
  fetchClientInfo: vi.fn().mockResolvedValue({ firstName: 'Ann', lastName: 'Able', email: 'a@vayd.test' }),
  fetchClientPets: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../auth/useAuth', () => ({ useAuth: () => authState.current }));

vi.mock('./StoreCartCardEntry', () => ({
  default: forwardRef(function FakeCardEntry() {
    return <div data-testid="new-card-entry">Enter a card</div>;
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

describe('StoreCartPage — OS-01-9: cart page hides cards from guests', () => {
  it('OS-01-9: a guest who types an email that has cards gets no card request and only the card entry', async () => {
    authState.current = { token: null, userId: null, clientInfo: null };
    localStorage.setItem('vayd_store_gift_cart', JSON.stringify([giftLine()]));
    renderCart();

    const email = await screen.findByLabelText('Email');
    await act(async () => {
      fireEvent.change(email, { target: { value: 'b@vayd.test' } });
    });
    // Let any effects that react to the email run.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(requestedUrls().filter((url) => /card|account|pay-balance/i.test(url))).toEqual([]);
    expect(screen.getByTestId('new-card-entry')).toHaveTextContent('Enter a card');
    expect(screen.queryByText(/Card on file/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/1111|4242/)).not.toBeInTheDocument();
  });

  it('OS-01-9 (D1 update): a guest with a store item is asked to log in, and the page asks for no cards', async () => {
    authState.current = { token: null, userId: null, clientInfo: null };
    localStorage.setItem('vayd_store_cart', JSON.stringify([storeLine()]));
    renderCart();

    expect(await screen.findByText('Log in to check out')).toBeInTheDocument();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(requestedUrls().filter((url) => /card|account|pay-balance/i.test(url))).toEqual([]);
    // No checkout form for a guest with store items: no card entry, no saved cards.
    expect(screen.queryByRole('button', { name: 'Place order' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('new-card-entry')).not.toBeInTheDocument();
    expect(screen.queryByText(/Card on file/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/1111|4242/)).not.toBeInTheDocument();
  });

  it('OS-01-9: a guest with a prescription item is asked to log in, and the page asks for no cards', async () => {
    authState.current = { token: null, userId: null, clientInfo: null };
    localStorage.setItem(
      'vayd_store_cart',
      JSON.stringify([{ ...storeLine(), approvalTag: 'needs_doctor_approval' }]),
    );
    renderCart();
    expect(await screen.findByText('Log in to check out')).toBeInTheDocument();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(requestedUrls().filter((url) => /card|account|pay-balance/i.test(url))).toEqual([]);
    expect(screen.queryByText(/Card on file/i)).not.toBeInTheDocument();
  });
});

describe('StoreCartPage — OS-01-10: a logged-in client sees its own cards', () => {
  it('OS-01-10: lists A’s cards from the login, and changing the email field doesn’t change the list', async () => {
    authState.current = {
      token: 'token-a',
      userId: '101',
      clientInfo: { firstName: 'Ann', lastName: 'Able', email: 'a@vayd.test' },
    };
    localStorage.setItem('vayd_store_cart', JSON.stringify([storeLine()]));
    renderCart();

    const select = await screen.findByRole('combobox');
    await waitFor(() => expect(select).toHaveTextContent('Visa •••• 4242'));
    expect(screen.getAllByRole('option')).toHaveLength(1);
    const cardRequests = () => requestedUrls().filter((url) => /card/i.test(url));
    expect(cardRequests()).toEqual(['/store/checkout/cards']);

    const email = screen.getByLabelText('Email');
    await act(async () => {
      fireEvent.change(email, { target: { value: 'b@vayd.test' } });
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(cardRequests()).toEqual(['/store/checkout/cards']);
    expect(screen.getByRole('combobox')).toHaveTextContent('Visa •••• 4242');
    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(requestedUrls().some((url) => url.includes('card-on-file'))).toBe(false);
  });
});

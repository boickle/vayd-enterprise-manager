/**
 * OS-02 frontend component test (docs/test-plans/online-store.md in vayd-api, D3).
 *
 *   OS-02-5  Checkout answers the decline error: the error is shown, the cart is kept, and the page does
 *            not go to the thank-you page.
 *
 * Every HTTP call the page makes goes through the mocked `http` client.
 */
import { forwardRef } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { AxiosError, AxiosHeaders } from 'axios';
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
  publicStoreProducts: vi.fn().mockResolvedValue([]),
  publicStoreTax: vi.fn().mockResolvedValue({ name: 'Sales Tax', rate: 0, level2Rate: 0, level3Rate: 0 }),
  publicStoreFulfillment: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../api/practices', () => ({ loadHostPractice: vi.fn().mockResolvedValue(undefined) }));

vi.mock('../../api/clientPortal', () => ({
  fetchClientInfo: vi.fn().mockResolvedValue({
    firstName: 'Ann',
    lastName: 'Able',
    email: 'a@vayd.test',
    mailingSameAsService: false,
    mailingAddress1: '12 Fixture Lane',
    mailingCity: 'Madison',
    mailingState: 'WI',
    mailingZipcode: '53703',
  }),
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

const DECLINED = 'Your card was declined. Nothing was charged.';
const CARD_A = { paymentMethodId: 'pm_a1', brand: 'visa', last4: '4242', expMonth: 12, expYear: 2030, recommended: true };
const LINE = {
  inventoryItemId: 11,
  name: 'Store item',
  quantity: 1,
  unitPrice: 40,
  autoshipFrequency: null,
  recommendedFrequency: null,
};

function declineError() {
  const response = {
    status: 400,
    statusText: 'Bad Request',
    data: { statusCode: 400, message: DECLINED },
    headers: {},
    config: { headers: new AxiosHeaders() },
  };
  return new AxiosError('Request failed with status code 400', 'ERR_BAD_REQUEST', undefined, undefined, response as never);
}

beforeEach(() => {
  localStorage.clear();
  for (const fn of Object.values(mockHttp)) (fn as Mock).mockReset();
  authState.current = {
    token: 'token-a',
    userId: '101',
    clientInfo: { firstName: 'Ann', lastName: 'Able', email: 'a@vayd.test' },
  };
  mockHttp.get.mockImplementation(async (url: string) => {
    if (url === '/store/checkout/cards') {
      return { data: { hasCard: true, brand: 'visa', last4: '4242', cards: [CARD_A] } };
    }
    if (url === '/store/checkout/account') return { data: { available: 0, owed: 0, invoices: [] } };
    return { data: [] };
  });
  mockHttp.post.mockImplementation(async (url: string) => {
    if (url === '/store/checkout') throw declineError();
    return { data: {} };
  });
});

describe('StoreCartPage — OS-02-5: a declined card keeps the cart', () => {
  it('OS-02-5: the decline error is shown, the cart is kept, and the page stays on the cart', async () => {
    localStorage.setItem('vayd_store_cart', JSON.stringify([LINE]));
    render(
      <MemoryRouter initialEntries={['/store/cart']}>
        <Routes>
          <Route path="/store/cart" element={<StoreCartPage />} />
          <Route path="/store/thanks/:id" element={<div>Thanks page</div>} />
        </Routes>
      </MemoryRouter>,
    );

    const select = await screen.findByRole('combobox');
    await waitFor(() => expect(select).toHaveTextContent('Visa •••• 4242'));
    await waitFor(() => expect(screen.getByLabelText('Email')).toHaveValue('a@vayd.test'));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Place order' }));
    });

    expect(await screen.findByText(DECLINED)).toBeInTheDocument();
    const checkoutCalls = mockHttp.post.mock.calls.filter((call) => call[0] === '/store/checkout');
    expect(checkoutCalls).toHaveLength(1);
    expect(checkoutCalls[0][1]).toMatchObject({ paymentMethodId: 'pm_a1' });
    // Cart kept, on screen and in storage; no thank-you page.
    expect(JSON.parse(localStorage.getItem('vayd_store_cart') || '[]')).toHaveLength(1);
    expect(screen.getAllByText('Store item').length).toBeGreaterThan(0);
    expect(screen.queryByText('Thanks page')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Place order' })).toBeEnabled();
  });
});

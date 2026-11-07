/**
 * OS-03 frontend component tests (docs/test-plans/online-store.md in vayd-api). The plan's OS-03 cases are
 * backend and end-to-end (OS-03-6 is the Cypress double click); these check the page's half of the fix:
 *
 *   OS-03 (page)  one attempt key per checkout attempt: a double click sends one checkout; a retry after no
 *                 answer (5xx) sends the same key; a definite refusal (4xx) starts a new attempt.
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

const CARD_A = { paymentMethodId: 'pm_a1', brand: 'visa', last4: '4242', expMonth: 12, expYear: 2030, recommended: true };
const LINE = {
  inventoryItemId: 11,
  name: 'Store item',
  quantity: 1,
  unitPrice: 40,
  autoshipFrequency: null,
  recommendedFrequency: null,
};

function apiError(status: number, message: string) {
  const response = {
    status,
    statusText: 'Error',
    data: { statusCode: status, message },
    headers: {},
    config: { headers: new AxiosHeaders() },
  };
  return new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_RESPONSE', undefined, undefined, response as never);
}

/** Answers for POST /store/checkout, in order. */
let checkoutAnswers: Array<() => Promise<unknown>> = [];

beforeEach(() => {
  localStorage.clear();
  for (const fn of Object.values(mockHttp)) (fn as Mock).mockReset();
  authState.current = {
    token: 'token-a',
    userId: '101',
    clientInfo: { firstName: 'Ann', lastName: 'Able', email: 'a@vayd.test' },
  };
  checkoutAnswers = [];
  mockHttp.get.mockImplementation(async (url: string) => {
    if (url === '/store/checkout/cards') {
      return { data: { hasCard: true, brand: 'visa', last4: '4242', cards: [CARD_A] } };
    }
    if (url === '/store/checkout/account') return { data: { available: 0, owed: 0, invoices: [] } };
    return { data: [] };
  });
  mockHttp.post.mockImplementation(async (url: string) => {
    if (url === '/store/checkout') {
      const next = checkoutAnswers.shift();
      if (!next) throw new Error('unexpected checkout');
      return next();
    }
    return { data: {} };
  });
});

const checkoutKeys = () =>
  mockHttp.post.mock.calls.filter((call) => call[0] === '/store/checkout').map((call) => (call[1] as { attemptKey?: string }).attemptKey);

async function renderReadyCart() {
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
}

describe('StoreCartPage — OS-03: one checkout per attempt', () => {
  it('OS-03 (page): a double click on Place order sends one checkout, with an attempt key', async () => {
    let release!: (v: unknown) => void;
    checkoutAnswers.push(() => new Promise((resolve) => (release = resolve)));
    await renderReadyCart();
    const button = screen.getByRole('button', { name: 'Place order' });
    await act(async () => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    expect(checkoutKeys()).toHaveLength(1);
    expect(checkoutKeys()[0]).toMatch(/^[A-Za-z0-9_-]{8,100}$/);
    await act(async () => {
      release({ data: { id: 501, lines: [] } });
    });
    expect(await screen.findByText('Thanks page')).toBeInTheDocument();
    expect(checkoutKeys()).toHaveLength(1);
  });

  it('OS-03 (page): after no answer (503) the retry sends the same key; after a refusal (400) a new key', async () => {
    checkoutAnswers.push(() => Promise.reject(apiError(503, 'We couldn’t confirm the payment with the card processor.')));
    checkoutAnswers.push(() => Promise.reject(apiError(400, 'Your card was declined. Nothing was charged.')));
    checkoutAnswers.push(() => Promise.resolve({ data: { id: 502, lines: [] } }));
    await renderReadyCart();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Place order' }));
    });
    expect(await screen.findByText(/couldn’t confirm the payment/)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Place order' }));
    });
    expect(await screen.findByText('Your card was declined. Nothing was charged.')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Place order' }));
    });
    expect(await screen.findByText('Thanks page')).toBeInTheDocument();

    const [first, retry, afterDecline] = checkoutKeys();
    expect(retry).toBe(first);
    expect(afterDecline).toBeTruthy();
    expect(afterDecline).not.toBe(first);
  });
});

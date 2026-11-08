/**
 * OS-06 frontend component test (docs/test-plans/online-store.md in vayd-api). The plan's OS-06 cases are
 * backend and end-to-end; this checks the cart page's half: while eVet sync is on, old eVet bills are shown
 * as not payable online and are not offered (or charged) with the order.
 */
import { forwardRef } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
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
  publicStoreTax: vi
    .fn()
    .mockResolvedValue({ name: 'Sales Tax', rate: 0, level2Rate: 0, level3Rate: 0 }),
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

const LINE = {
  inventoryItemId: 11,
  name: 'Store item',
  quantity: 1,
  unitPrice: 40,
  autoshipFrequency: null,
  recommendedFrequency: null,
};

function mockAccount(account: Record<string, unknown>) {
  mockHttp.get.mockImplementation(async (url: string) => {
    if (url === '/store/checkout/cards') return { data: { hasCard: false, cards: [] } };
    if (url === '/store/checkout/account') return { data: account };
    return { data: [] };
  });
}

beforeEach(() => {
  localStorage.clear();
  for (const fn of Object.values(mockHttp)) (fn as Mock).mockReset();
  mockHttp.post.mockResolvedValue({ data: {} });
  authState.current = {
    token: 'token-a',
    userId: '101',
    clientInfo: { firstName: 'Ann', lastName: 'Able', email: 'a@vayd.test' },
  };
  localStorage.setItem('vayd_store_cart', JSON.stringify([LINE]));
});

function renderCart() {
  return render(
    <MemoryRouter initialEntries={['/store/cart']}>
      <Routes>
        <Route path="/store/cart" element={<StoreCartPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('StoreCartPage — OS-06: old eVet bills while eVet sync is on', () => {
  it('OS-06 (page): an eVet-only balance is shown as not payable online, and no "pay the balance" option', async () => {
    mockAccount({ available: 0, owed: 80, payableOwed: 0, evetNotPayable: 80, invoices: [] });
    renderCart();
    expect(
      await screen.findByText(/\$80\.00 is on older bills from our previous system/)
    ).toBeInTheDocument();
    expect(screen.queryByText(/Pay the \$/)).not.toBeInTheDocument();
  });

  it('OS-06 (page): with a Scout bill too, only the payable part is offered', async () => {
    mockAccount({ available: 0, owed: 130, payableOwed: 50, evetNotPayable: 80, invoices: [] });
    renderCart();
    expect(await screen.findByText('Pay the $50.00 balance with this order')).toBeInTheDocument();
    expect(screen.getByText(/\$80\.00 is on older bills/)).toBeInTheDocument();
  });

  it('OS-06 (page): with eVet sync off everything owed is offered and there is no note', async () => {
    mockAccount({ available: 0, owed: 80, payableOwed: 80, evetNotPayable: 0, invoices: [] });
    renderCart();
    expect(await screen.findByText('Pay the $80.00 balance with this order')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(/older bills/)).not.toBeInTheDocument());
  });
});

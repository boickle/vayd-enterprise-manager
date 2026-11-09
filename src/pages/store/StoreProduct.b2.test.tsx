/**
 * B2 (owner, Nov 7, 2026): a guest is told the login rule on the product page. Prescription and pet items show
 * "Log in to order" instead of Add to cart; no guest is offered auto-ship; nobody reads "Anyone can order".
 */
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { vi } from 'vitest';

const { pricing, product } = vi.hoisted(() => ({
  pricing: { current: { loggedIn: false, pets: [] as unknown[] } },
  product: { current: null as Record<string, unknown> | null },
}));

vi.mock('../../api/onlineStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/onlineStore')>()),
  publicStoreProducts: vi.fn().mockResolvedValue([]),
  publicStoreProduct: vi.fn().mockImplementation(async () => product.current),
}));
vi.mock('./useStoreMemberPricing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./useStoreMemberPricing')>()),
  useStoreMemberPricing: () => ({ ...pricing.current, memberPct: () => 0, discountFor: () => 0 }),
}));
vi.mock('./useStorePracticeId', () => ({ useStorePracticeId: () => ({ practiceId: 1, ready: true }) }));
vi.mock('./StoreRebatePromo', () => ({ default: () => null }));

import StoreProduct from './StoreProduct';

const listing = (o: Record<string, unknown>) => ({
  listingId: 'p-1',
  storeProductId: 1,
  name: 'Heartworm & flea chewable',
  description: null,
  approvalTag: 'approved',
  requiresPet: false,
  kind: 'standard',
  variants: [
    { inventoryItemId: 11, procedureId: null, name: 'Heartworm & flea chewable', onlineStorePrice: 89, price: 89, optionValues: [], stockStatus: 'in_stock' },
  ],
  ...o,
});

const show = () =>
  render(
    <MemoryRouter initialEntries={['/store/p-1']}>
      <Routes>
        <Route path="/store/:id" element={<StoreProduct />} />
      </Routes>
    </MemoryRouter>,
  );

describe('B2: guests and the login rule on the product page', () => {
  it('B2-1: a guest on a prescription item sees the login note and "Log in to order", not Add to cart or auto-ship', async () => {
    pricing.current = { loggedIn: false, pets: [] };
    product.current = listing({ approvalTag: 'needs_doctor_approval' });
    show();
    await waitFor(() => expect(screen.getByText(/Log in to your client portal to order it/)).toBeTruthy());
    expect(screen.queryByText(/Anyone can order/)).toBeNull();
    expect(screen.getByRole('link', { name: 'Log in to order' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Add to cart/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Auto-ship/ })).toBeNull();
  });

  it('B2-2: a guest on a one-time, non-prescription item can add it to the cart, without auto-ship', async () => {
    pricing.current = { loggedIn: false, pets: [] };
    product.current = listing({ name: 'Dental chews' });
    show();
    await waitFor(() => expect(screen.getByRole('button', { name: /Add to cart/ })).toBeTruthy());
    expect(screen.queryByRole('button', { name: /Auto-ship/ })).toBeNull();
  });

  it('B2-3: a logged-in client on a prescription item reads that a doctor checks it, and can add it', async () => {
    pricing.current = { loggedIn: true, pets: [] };
    product.current = listing({ approvalTag: 'needs_doctor_approval' });
    show();
    await waitFor(() => expect(screen.getByText(/A doctor checks every order before we mail it/)).toBeTruthy());
    expect(screen.queryByText(/Anyone can order/)).toBeNull();
    expect(screen.getByRole('button', { name: /Add to cart/ })).toBeTruthy();
  });
});

/**
 * CAT-04-5 (create form tax default), CAT-05-2..5 (confirm before a store price reaches auto-ships)
 * and CAT-01-7 (Hide on invoice hint), docs/test-plans/catalog-and-pricing.md.
 * The page runs for real; only the HTTP layer and the confirm dialog are faked.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Call = { method: string; url: string; body?: unknown };
const calls: Call[] = [];
const appConfirm = vi.fn();
let autoshipCounts: Record<number, number> = {};
let itemRows: Record<number, Record<string, unknown>> = {};

function inventoryRow(id: number, over: Record<string, unknown> = {}) {
  return {
    id,
    name: `Item ${id}`,
    price: 50,
    cost: 20,
    taxLevelValue: 1,
    isActive: true,
    showOnOnlineStore: true,
    onlineStorePrice: 40,
    ...over,
  };
}

function route(method: string, url: string, body?: unknown) {
  calls.push({ method, url, body });
  const item = url.match(/^\/quantity-price-breaks\/item\/inventory\/(\d+)/);
  if (method === 'get' && item) {
    const id = Number(item[1]);
    return { itemType: 'inventory', item: itemRows[id], priceBreaks: [] };
  }
  if (method === 'get' && /\/inventory-items\/autoship-counts/.test(url)) {
    return { counts: autoshipCounts };
  }
  if (method === 'get' && url.includes('/quantity-price-breaks/items/search')) {
    return Object.keys(itemRows).map((id) => ({
      itemType: 'inventory',
      inventoryItem: itemRows[Number(id)],
      name: `Item ${id}`,
      code: null,
      price: 50,
    }));
  }
  if (method === 'get' && /\/settings$/.test(url)) return { 'inventory.onlineStoreImplemented': 'true' };
  if (method === 'get' && url.includes('/online-store/catalog-listing')) return null;
  if (method === 'get' && /\/branches$|\/branches\?/.test(url)) return [];
  if (method === 'get' && url.includes('/taxes')) {
    return { taxLevel1Rate: 0.055, taxLevel2Rate: 0, taxLevel3Rate: 0, showTaxLevel2: false };
  }
  if (method === 'post' && url.includes('bulk-price-adjust')) return { updated: 1 };
  if (method === 'get') return [];
  return {};
}

vi.mock('../api/http', () => {
  const make = (method: string) =>
    vi.fn(async (url: string, a?: unknown, b?: unknown) => ({
      data: route(method, url, method === 'get' || method === 'delete' ? undefined : a),
      status: 200,
      _b: b,
    }));
  return {
    http: { get: make('get'), post: make('post'), patch: make('patch'), put: make('put'), delete: make('delete') },
    apiBaseUrl: 'http://test',
    practiceHostHeaders: () => ({}),
    getAuthToken: () => null,
  };
});
vi.mock('../utils/appDialog', () => ({
  appConfirm: (...a: unknown[]) => appConfirm(...a),
  appPrompt: vi.fn(),
  appAlert: vi.fn(),
}));
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ token: null }) }));
vi.mock('../permissions/PermissionContext', () => ({
  usePermissions: () => ({ can: () => true, scopeOf: () => 'all', hasRole: () => true }),
}));
vi.mock('../utils/practiceIdFromToken', () => ({ currentPracticeId: () => 1, resolvePracticeIdFromToken: () => 1 }));

import Catalog from './Catalog';

const patches = () => calls.filter((c) => c.method === 'patch' && /inventory-items\/\d+$/.test(c.url));

async function openStoreTab(itemId: number) {
  render(
    <MemoryRouter>
      <Catalog embed={{ itemId, itemType: 'inventory', label: `Item ${itemId}`, onClose: () => undefined }} />
    </MemoryRouter>
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Online Store' }));
  return screen.findByLabelText(/Online store price/);
}

beforeEach(() => {
  calls.length = 0;
  appConfirm.mockReset().mockResolvedValue(true);
  autoshipCounts = {};
  itemRows = { 7: inventoryRow(7) };
});

describe('CAT-05 store price and auto-ships', () => {
  it('CAT-05-2: names the auto-ships and the email; Cancel sends no PATCH', async () => {
    autoshipCounts = { 7: 3 };
    appConfirm.mockResolvedValue(false);
    const price = await openStoreTab(7);
    fireEvent.change(price, { target: { value: '44' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save online store details' }));
    await waitFor(() => expect(appConfirm).toHaveBeenCalledTimes(1));
    const msg = JSON.stringify(appConfirm.mock.calls[0][0]);
    expect(msg).toContain('3 auto-ships will be repriced');
    expect(msg).toContain('emailed within the hour');
    expect(patches()).toHaveLength(0);
  });

  it('CAT-05-2b: confirming sends the PATCH', async () => {
    autoshipCounts = { 7: 3 };
    const price = await openStoreTab(7);
    fireEvent.change(price, { target: { value: '44' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save online store details' }));
    await waitFor(() => expect(patches().length).toBeGreaterThan(0));
    expect((patches()[0].body as { onlineStorePrice: number }).onlineStorePrice).toBe(44);
  });

  it('CAT-05-3: a list price change alone (store price untouched) asks nothing', async () => {
    autoshipCounts = { 7: 3 };
    render(
      <MemoryRouter>
        <Catalog embed={{ itemId: 7, itemType: 'inventory', label: 'Item 7', onClose: () => undefined }} />
      </MemoryRouter>
    );
    const list = await screen.findByLabelText(/^Price/, { selector: 'input' });
    fireEvent.change(list, { target: { value: '55' } });
    fireEvent.click(screen.getByRole('button', { name: /^Save/ }));
    await waitFor(() => expect(patches().length).toBeGreaterThan(0));
    expect(appConfirm).not.toHaveBeenCalled();
  });

  it('CAT-05-5: no auto-ships, no dialog', async () => {
    autoshipCounts = {};
    const price = await openStoreTab(7);
    fireEvent.change(price, { target: { value: '44' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save online store details' }));
    await waitFor(() => expect(patches().length).toBeGreaterThan(0));
    expect(appConfirm).not.toHaveBeenCalled();
  });

  it('CAT-05-4: bulk online store % names the auto-ships and the items', async () => {
    itemRows = { 1: inventoryRow(1), 2: inventoryRow(2), 3: inventoryRow(3), 4: inventoryRow(4), 5: inventoryRow(5) };
    autoshipCounts = { 2: 1, 4: 3 };
    appConfirm.mockResolvedValue(false);
    render(
      <MemoryRouter>
        <Catalog />
      </MemoryRouter>
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Show all' }));
    fireEvent.click(await screen.findByLabelText(/Select inventory rows for bulk price change/));
    for (let i = 1; i <= 5; i++) fireEvent.click(await screen.findByLabelText(`Select Item ${i} for bulk pricing`));
    fireEvent.click(screen.getByRole('button', { name: /Bulk adjust prices/ }));
    fireEvent.change(await screen.findByLabelText(/Online store price.*%|% .*online store/i), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply to selected' }));
    await waitFor(() => expect(appConfirm).toHaveBeenCalledTimes(1));
    const msg = JSON.stringify(appConfirm.mock.calls[0][0]);
    expect(msg).toContain('4 auto-ships');
    expect(msg).toContain('2 items');
    expect(calls.filter((c) => c.url.includes('bulk-price-adjust'))).toHaveLength(0);
  });
});

describe('CAT-04-5 create form tax default', () => {
  it('shows None, None, Sales Tax and keeps a value the user picked', async () => {
    render(
      <MemoryRouter initialEntries={['/?create=1']}>
        <Catalog />
      </MemoryRouter>
    );
    const dialog = await screen.findByRole('dialog', { name: /Add/ });
    const taxSelect = () => within(dialog).getByLabelText(/Tax/i) as HTMLSelectElement;
    const labelOf = () => taxSelect().selectedOptions[0].textContent;
    expect(labelOf()).toMatch(/Sales Tax/);
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Lab' }));
    expect(labelOf()).toMatch(/None/);
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Procedure' }));
    expect(labelOf()).toMatch(/None/);
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Product' }));
    expect(labelOf()).toMatch(/Sales Tax/);
    // The user picks a level; changing the type does not reset it.
    fireEvent.change(taxSelect(), { target: { value: '0' } });
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Lab' }));
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Product' }));
    expect(labelOf()).toMatch(/None/);
  });
});

describe('CAT-01-7 hide on invoice hint', () => {
  it('says lines with a charge are always shown to clients', async () => {
    render(
      <MemoryRouter initialEntries={['/?create=1']}>
        <Catalog />
      </MemoryRouter>
    );
    const dialog = await screen.findByRole('dialog', { name: /Add/ });
    expect(within(dialog).getByText(/Lines with a charge are always shown to the client; only \$0 lines are hidden\./)).toBeInTheDocument();
  });
});

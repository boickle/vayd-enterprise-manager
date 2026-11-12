/**
 * CAT-A9 missing cost filter: the inventory list can show only products whose cost is empty,
 * null, 0 or negative, so staff can find and fix them. The page runs for real; only HTTP is faked.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let itemRows: Record<number, Record<string, unknown>> = {};
/** When set, the search endpoint pages through these rows by offset/limit (like the server). */
let pagedRows: Record<string, unknown>[] | null = null;
const searchParams: Record<string, unknown>[] = [];

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

function searchRow(item: Record<string, unknown>) {
  return {
    itemType: 'inventory',
    inventoryItem: item,
    name: `Item ${item.id}`,
    code: null,
    price: 50,
  };
}

function route(method: string, url: string, params?: Record<string, unknown>) {
  if (method === 'get' && url.includes('/quantity-price-breaks/items/search')) {
    searchParams.push(params ?? {});
    if (pagedRows) {
      const offset = Number(params?.offset ?? 0);
      const limit = Number(params?.limit ?? 100);
      return pagedRows.slice(offset, offset + limit).map(searchRow);
    }
    return Object.keys(itemRows).map((id) => searchRow(itemRows[Number(id)]));
  }
  if (method === 'get' && /\/inventory-items\/autoship-counts/.test(url)) return { counts: {} };
  if (method === 'get' && /\/settings$/.test(url)) return { 'inventory.onlineStoreImplemented': 'true' };
  if (method === 'get' && url.includes('/online-store/catalog-listing')) return null;
  if (method === 'get' && /\/branches$|\/branches\?/.test(url)) return [];
  if (method === 'get' && url.includes('/taxes')) {
    return { taxLevel1Rate: 0.055, taxLevel2Rate: 0, taxLevel3Rate: 0, showTaxLevel2: false };
  }
  if (method === 'get') return [];
  return {};
}

vi.mock('../api/http', () => {
  const make = (method: string) =>
    vi.fn(async (url: string, cfg?: { params?: Record<string, unknown> }) => ({
      data: route(method, url, cfg?.params),
      status: 200,
    }));
  return {
    http: { get: make('get'), post: make('post'), patch: make('patch'), put: make('put'), delete: make('delete') },
    apiBaseUrl: 'http://test',
    practiceHostHeaders: () => ({}),
    getAuthToken: () => null,
  };
});
vi.mock('../utils/appDialog', () => ({
  appConfirm: vi.fn(),
  appPrompt: vi.fn(),
  appAlert: vi.fn(),
}));
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ token: null }) }));
vi.mock('../permissions/PermissionContext', () => ({
  usePermissions: () => ({ can: () => true, scopeOf: () => 'all', hasRole: () => true }),
}));
vi.mock('../utils/practiceIdFromToken', () => ({ currentPracticeId: () => 1, resolvePracticeIdFromToken: () => 1 }));

import Catalog from './Catalog';

beforeEach(() => {
  pagedRows = null;
  searchParams.length = 0;
  itemRows = {
    1: inventoryRow(1, { cost: 12.5 }),
    2: inventoryRow(2, { cost: null }),
    3: inventoryRow(3, { cost: 0 }),
  };
});

describe('CAT-A9 missing cost filter', () => {
  it('shows only items with no cost when on, and all items when off', async () => {
    render(
      <MemoryRouter>
        <Catalog />
      </MemoryRouter>
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Show all' }));
    expect(await screen.findByText('Item 1', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('Item 2', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('Item 3', { exact: true })).toBeInTheDocument();

    const toggle = screen.getByLabelText('Missing cost');
    expect(toggle).not.toBeChecked();

    // The list reloads from the server after each toggle, so wait for it to settle.
    fireEvent.click(toggle);
    expect(toggle).toBeChecked();
    await waitFor(() => expect(screen.queryByText('Item 1', { exact: true })).toBeNull());
    expect(await screen.findByText('Item 2', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('Item 3', { exact: true })).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).not.toBeChecked();
    expect(await screen.findByText('Item 1', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('Item 2', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('Item 3', { exact: true })).toBeInTheDocument();
  });
});

describe('CAT-A9 missing cost filter covers the whole catalog', () => {
  it('pages through every inventory page with no search text and finds a null-cost row on page 2', async () => {
    // Page 1 is a full page of priced products; page 2 is short and holds one product with no cost.
    const page1 = Array.from({ length: 100 }, (_, i) => inventoryRow(i + 1, { cost: 20 }));
    const page2 = [
      inventoryRow(101, { cost: 20 }),
      inventoryRow(102, { cost: null }),
      inventoryRow(103, { cost: 20 }),
    ];
    pagedRows = [...page1, ...page2];

    render(
      <MemoryRouter>
        <Catalog />
      </MemoryRouter>
    );
    // No search text and "Show all" stays off: ticking Missing cost alone must still load.
    fireEvent.click(await screen.findByLabelText('Missing cost'));

    expect(await screen.findByText('Item 102', { exact: true })).toBeInTheDocument();
    expect(screen.queryByText('Item 1', { exact: true })).toBeNull();
    expect(screen.queryByText('Item 101', { exact: true })).toBeNull();
    expect(screen.queryByRole('button', { name: /Load more/i })).toBeNull();

    const offsets = searchParams.map((p) => Number(p.offset ?? 0));
    expect(offsets).toEqual([0, 100]);
    expect(searchParams.every((p) => p.types === 'inventory')).toBe(true);
  });
});


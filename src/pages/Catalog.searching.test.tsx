/**
 * Catalog search must not say "No matches." while a search is still on its way (seen in the
 * PRC-02 and PRC-04 training takes, Nov 12). The page runs for real; only HTTP is faked, and the
 * search answer is held back until the test releases it.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let itemRows: Record<number, Record<string, unknown>> = {};
/** When set, the search endpoint pages through these rows by offset/limit (like the server). */
let pagedRows: Record<string, unknown>[] | null = null;
const searchParams: Record<string, unknown>[] = [];
let releaseSearch: () => void = () => undefined;
let searchGate: Promise<void> = Promise.resolve();
function holdSearches() {
  searchGate = new Promise<void>((resolve) => {
    releaseSearch = resolve;
  });
}

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
  if (method === 'get' && /\/settings$/.test(url))
    return { 'inventory.onlineStoreImplemented': 'true' };
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
    vi.fn(async (url: string, cfg?: { params?: Record<string, unknown> }) => {
      if (method === 'get' && url.includes('/quantity-price-breaks/items/search')) await searchGate;
      return { data: route(method, url, cfg?.params), status: 200 };
    });
  return {
    http: {
      get: make('get'),
      post: make('post'),
      patch: make('patch'),
      put: make('put'),
      delete: make('delete'),
    },
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
vi.mock('../utils/practiceIdFromToken', () => ({
  currentPracticeId: () => 1,
  resolvePracticeIdFromToken: () => 1,
}));

import { act } from 'react';
import Catalog from './Catalog';

beforeEach(() => {
  pagedRows = null;
  searchParams.length = 0;
  searchGate = Promise.resolve();
  itemRows = { 1: inventoryRow(1, { name: 'Cerenia 24 mg tablet' }) };
});

function searchBox() {
  return screen.getByPlaceholderText(/Search products/i);
}

describe('Catalog search while results are loading', () => {
  it('says Searching…, not No matches., until the results arrive', async () => {
    holdSearches();
    render(
      <MemoryRouter>
        <Catalog />
      </MemoryRouter>
    );
    await screen.findByText(/Type to search/);
    fireEvent.change(searchBox(), { target: { value: 'Cerenia' } });

    // Before the debounce fires and while the request is held, never "No matches.".
    expect(screen.getByText('Searching…')).toBeInTheDocument();
    expect(screen.queryByText('No matches.')).toBeNull();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });
    expect(screen.getByText('Searching…')).toBeInTheDocument();
    expect(screen.queryByText('No matches.')).toBeNull();

    await act(async () => releaseSearch());
    expect(await screen.findByText('Item 1', { exact: true })).toBeInTheDocument();
    expect(screen.queryByText('Searching…')).toBeNull();
  });

  it('still says No matches. once a search really finds nothing', async () => {
    itemRows = {};
    render(
      <MemoryRouter>
        <Catalog />
      </MemoryRouter>
    );
    await screen.findByText(/Type to search/);
    fireEvent.change(searchBox(), { target: { value: 'zzz' } });
    expect(await screen.findByText('No matches.')).toBeInTheDocument();
    expect(screen.queryByText('Searching…')).toBeNull();
  });

  it('clearing the box goes back to the prompt, not Searching…', async () => {
    render(
      <MemoryRouter>
        <Catalog />
      </MemoryRouter>
    );
    await screen.findByText(/Type to search/);
    fireEvent.change(searchBox(), { target: { value: 'Cer' } });
    fireEvent.change(searchBox(), { target: { value: '' } });
    expect(screen.getByText(/Type to search/)).toBeInTheDocument();
    expect(screen.queryByText('Searching…')).toBeNull();
  });
});

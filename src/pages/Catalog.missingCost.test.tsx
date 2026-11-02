/**
 * CAT-A9 missing cost filter: the inventory list can show only products whose cost is empty,
 * null, 0 or negative, so staff can find and fix them. The page runs for real; only HTTP is faked.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

function route(method: string, url: string) {
  if (method === 'get' && url.includes('/quantity-price-breaks/items/search')) {
    return Object.keys(itemRows).map((id) => ({
      itemType: 'inventory',
      inventoryItem: itemRows[Number(id)],
      name: `Item ${id}`,
      code: null,
      price: 50,
    }));
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
    vi.fn(async (url: string) => ({ data: route(method, url), status: 200 }));
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

    fireEvent.click(toggle);
    expect(toggle).toBeChecked();
    expect(screen.queryByText('Item 1', { exact: true })).toBeNull();
    expect(screen.getByText('Item 2', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('Item 3', { exact: true })).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).not.toBeChecked();
    expect(screen.getByText('Item 1', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('Item 2', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('Item 3', { exact: true })).toBeInTheDocument();
  });
});

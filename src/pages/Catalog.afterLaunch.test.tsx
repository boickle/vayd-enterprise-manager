/**
 * After-launch catalog screen fixes: CAT-A3 (bulk preview/reason), CAT-A10 (concurrent edit message),
 * CAT-A13 (price below cost warning). The page runs for real; only HTTP and dialogs are faked.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Call = { method: string; url: string; body?: unknown };
const calls: Call[] = [];
const appConfirm = vi.fn();
let autoshipCounts: Record<number, number> = {};
let itemRows: Record<number, Record<string, unknown>> = {};
let patchError: unknown = null;
let previewReply: unknown = null;

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
  if (method === 'post' && url.includes('bulk-price-adjust')) {
    if ((body as { dryRun?: boolean })?.dryRun) return previewReply;
    return { updated: 1 };
  }
  if (method === 'patch' && patchError) throw patchError;
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

beforeEach(() => {
  calls.length = 0;
  appConfirm.mockReset().mockResolvedValue(true);
  autoshipCounts = {};
  patchError = null;
  itemRows = { 7: inventoryRow(7, { externalUpdated: '2026-11-01T10:00:00.000Z', markup: 250 }) };
  previewReply = {
    dryRun: true,
    updated: 1,
    branchPricesUpdated: 0,
    items: [
      {
        id: 7, name: 'Item 7', code: null, cost: 20,
        practicePriceBefore: 50, practicePriceAfter: 55, storePriceBefore: 40, storePriceAfter: 40,
        markupBefore: 250, markupAfter: 275, branchPrices: [],
      },
    ],
  };
});

const patches = () => calls.filter((c) => c.method === 'patch' && /inventory-items\/\d+$/.test(c.url));
const bulkPosts = () => calls.filter((c) => c.method === 'post' && c.url.includes('bulk-price-adjust'));

function openItem(itemId = 7) {
  render(
    <MemoryRouter>
      <Catalog embed={{ itemId, itemType: 'inventory', label: `Item ${itemId}`, onClose: () => undefined }} />
    </MemoryRouter>
  );
}

describe('CAT-A3 bulk price change: preview, reason, request id', () => {
  async function openBulk() {
    render(
      <MemoryRouter>
        <Catalog />
      </MemoryRouter>
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Show all' }));
    fireEvent.click(await screen.findByLabelText(/Select inventory rows for bulk price change/));
    fireEvent.click(await screen.findByLabelText('Select Item 7 for bulk pricing'));
    fireEvent.click(screen.getByRole('button', { name: /Bulk adjust prices/ }));
    fireEvent.change(await screen.findByLabelText(/% change.*practice/i), { target: { value: '10' } });
  }

  it('shows before and after first and applies only after Confirm, with the reason and one request id', async () => {
    await openBulk();
    fireEvent.click(screen.getByRole('button', { name: 'Apply to selected' }));
    await screen.findByText(/Item 7/, { selector: '[data-bulk-preview] *' });
    expect(bulkPosts()).toHaveLength(1);
    expect((bulkPosts()[0].body as { dryRun?: boolean }).dryRun).toBe(true);
    const preview = document.querySelector('[data-bulk-preview]') as HTMLElement;
    expect(preview.textContent).toContain('$50.00');
    expect(preview.textContent).toContain('$55.00');

    // A reason is needed before anything is saved.
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and apply' }));
    expect(await screen.findByText(/reason/i, { selector: '.settings-error-message' })).toBeInTheDocument();
    expect(bulkPosts()).toHaveLength(1);

    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'Vendor increase' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and apply' }));
    await waitFor(() => expect(bulkPosts()).toHaveLength(2));
    const real = bulkPosts()[1].body as { dryRun?: boolean; reason?: string; requestId?: string };
    expect(real.dryRun).toBeFalsy();
    expect(real.reason).toBe('Vendor increase');
    expect(real.requestId).toBeTruthy();
  });
});

describe('CAT-A10 concurrent edits', () => {
  it('sends the loaded timestamp; on a 409 shows the message and a Reload button', async () => {
    patchError = {
      message: 'Request failed with status code 409',
      response: { status: 409, data: { message: 'This item changed since you opened it. Reload to see the latest.' } },
    };
    openItem();
    const list = await screen.findByLabelText(/^Price/, { selector: 'input' });
    fireEvent.change(list, { target: { value: '55' } });
    fireEvent.click(screen.getByRole('button', { name: /^Save/ }));
    await waitFor(() => expect(patches().length).toBeGreaterThan(0));
    expect((patches()[0].body as { expectedUpdated?: string }).expectedUpdated).toBe('2026-11-01T10:00:00.000Z');
    expect(await screen.findByText(/changed since you opened it/)).toBeInTheDocument();
    const reload = screen.getByRole('button', { name: 'Reload' });
    const gets = calls.filter((c) => c.method === 'get').length;
    fireEvent.click(reload);
    await waitFor(() => expect(calls.filter((c) => c.method === 'get').length).toBeGreaterThan(gets));
  });
});

describe('CAT-A13 price below cost warning', () => {
  it('warns on the edit screen when price is under cost, and when markup is under 100%', async () => {
    itemRows = { 7: inventoryRow(7, { price: 10, cost: 20, markup: 50 }) };
    openItem();
    expect(await screen.findByText(/Price \$10\.00 is below cost \$20\.00/)).toBeInTheDocument();
    expect(screen.getByText(/Markup is under 100%/)).toBeInTheDocument();
  });

  it('shows no warning when price is above cost', async () => {
    openItem();
    await screen.findByLabelText(/^Price/, { selector: 'input' });
    expect(screen.queryByText(/is below cost \$/)).toBeNull();
    expect(screen.queryByText(/Markup is under 100%/)).toBeNull();
  });

  it('warns on the create form as price and cost are typed', async () => {
    render(
      <MemoryRouter initialEntries={['/?create=1']}>
        <Catalog />
      </MemoryRouter>
    );
    const dialog = await screen.findByRole('dialog', { name: /Add/ });
    fireEvent.change(within(dialog).getByLabelText(/^Cost/), { target: { value: '20' } });
    fireEvent.change(within(dialog).getByLabelText(/^Price/), { target: { value: '12' } });
    expect(within(dialog).getByText(/Price \$12\.00 is below cost \$20\.00/)).toBeInTheDocument();
  });
});

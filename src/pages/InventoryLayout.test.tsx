/**
 * Found in the inventory end-to-end pass (INV-05-8): opening a gated Pharmacy page directly
 * mounted before permissions loaded, so a practice manager was sent from Cost Reviews to Counts.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { vi } from 'vitest';
import InventoryLayout from './InventoryLayout';

const perms = vi.hoisted(() => ({
  effective: null as null | object,
  error: null as null | string,
  canCost: false,
  roles: [] as string[],
  keys: new Set<string>(),
}));

vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ token: 't', role: 'employee' }) }));
vi.mock('../permissions/PermissionContext', () => ({
  usePermissions: () => ({
    hasRole: (...wanted: string[]) => wanted.some((r) => perms.roles.includes(r)),
    effective: perms.effective,
    error: perms.error,
  }),
  useCan: (key: string) =>
    (key === 'inventory.cost_review.manage' && perms.canCost) || perms.keys.has(key),
}));
vi.mock('../utils/useInventoryAttention', () => ({
  useInventoryAttention: () => ({}),
  AttentionBadge: () => null,
}));
vi.mock('../components/inventory/ReleasedStockLinksNotice', () => ({ default: () => null }));

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/schedule/inventory" element={<InventoryLayout />}>
          <Route path="cost-reviews" element={<p>Cost Reviews page</p>} />
          <Route path="counts" element={<p>Counts page</p>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

describe('Pharmacy pages wait for permissions before redirecting', () => {
  it('holds a direct link to Cost Reviews while permissions load', () => {
    perms.effective = null;
    perms.canCost = false;
    renderAt('/schedule/inventory/cost-reviews');
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(screen.queryByText('Counts page')).not.toBeInTheDocument();
  });

  it('opens Cost Reviews for someone who holds it once permissions load', () => {
    perms.effective = { permissions: {} };
    perms.canCost = true;
    renderAt('/schedule/inventory/cost-reviews');
    expect(screen.getByText('Cost Reviews page')).toBeInTheDocument();
  });

  it('still sends someone without it to Counts', () => {
    perms.effective = { permissions: {} };
    perms.canCost = false;
    renderAt('/schedule/inventory/cost-reviews');
    expect(screen.getByText('Counts page')).toBeInTheDocument();
  });
});

/**
 * Owner decisions (Oct 30, 2026): Store, the mail order queue and auto-ships go to practice
 * management and the mail order roles, not inventory managers; Manage and Setup are practice
 * manager and admin only.
 */
describe('Pharmacy menus by role', () => {
  const as = (roles: string[], keys: string[]) => {
    perms.effective = { permissions: {} };
    perms.canCost = false;
    perms.roles = roles;
    perms.keys = new Set(keys);
    renderAt('/schedule/inventory/counts');
  };
  const tabs = () => ({
    store: screen.queryByRole('button', { name: /Store/ }) ?? screen.queryByText('Store'),
    queue: screen.queryByRole('link', { name: 'Mail Order Queue' }),
    autoships: screen.queryByRole('link', { name: 'Auto-ships' }),
    manage: screen.queryByText('Manage'),
    setup: screen.queryByText('Setup'),
  });

  it('an inventory manager sees none of Store, the queue, auto-ships, Manage or Setup', () => {
    as(['inventory_manager'], []);
    const t = tabs();
    expect([t.store, t.queue, t.autoships, t.manage, t.setup]).toEqual([null, null, null, null, null]);
  });

  it('a mail order manager sees Store, the queue and auto-ships, but not Manage or Setup', () => {
    as(['mail_order_manager'], [
      'store.listing.manage',
      'store.category.manage',
      'store.abandoned_cart.resend',
      'mail_order.fulfill',
      'store.subscription.manage',
    ]);
    const t = tabs();
    expect(t.store).not.toBeNull();
    expect(t.queue).not.toBeNull();
    expect(t.autoships).not.toBeNull();
    expect(t.manage).toBeNull();
    expect(t.setup).toBeNull();
  });

  it('a mail order team member sees the queue and auto-ships only', () => {
    as(['mail_order_team'], ['mail_order.fulfill', 'store.subscription.manage']);
    const t = tabs();
    expect(t.store).toBeNull();
    expect(t.queue).not.toBeNull();
    expect(t.autoships).not.toBeNull();
    expect(t.manage).toBeNull();
  });

  it('a practice manager sees Manage and Setup', () => {
    as(['practice_manager'], ['store.listing.manage', 'mail_order.fulfill', 'store.subscription.manage']);
    const t = tabs();
    expect(t.manage).not.toBeNull();
    expect(t.setup).not.toBeNull();
  });
});

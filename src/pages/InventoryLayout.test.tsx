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
}));

vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ token: 't', role: 'employee' }) }));
vi.mock('../permissions/PermissionContext', () => ({
  usePermissions: () => ({ hasRole: () => false, effective: perms.effective, error: perms.error }),
  useCan: (key: string) => key === 'inventory.cost_review.manage' && perms.canCost,
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

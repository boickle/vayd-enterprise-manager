/** CAT-10: the Stale lots report lists flagged lots with why, filters, and adds items to the weekly count. */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';
import InventoryStaleLotsReportPage from './InventoryStaleLotsReportPage';

const perms = vi.hoisted(() => ({ keys: [] as string[] }));
const listStaleLots = vi.hoisted(() => vi.fn());
const addWeeklyCountItems = vi.hoisted(() => vi.fn());

vi.mock('../permissions/PermissionContext', () => ({
  usePermissions: () => ({ can: (key: string) => perms.keys.includes(key) }),
}));
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ token: null }) }));
vi.mock('../auth/impersonationSession', () => ({ readImpersonation: () => null }));
vi.mock('../utils/practiceIdFromToken', () => ({ resolvePracticeIdFromToken: () => 1 }));
vi.mock('../api/permissions', () => ({ fetchMyOffices: async () => 'all' as const }));
vi.mock('../api/branchInventory', () => ({
  listPracticeBranches: async () => [
    { id: 1, name: 'Kingfield Office', isActive: true },
    { id: 2, name: 'Uptown Office', isActive: true },
  ],
}));
vi.mock('../api/inventoryCounts', () => ({
  listStaleLots: (...a: unknown[]) => listStaleLots(...a),
  addWeeklyCountItems: (...a: unknown[]) => addWeeklyCountItems(...a),
}));

const row = (over: Record<string, unknown>) => ({
  lotId: 1,
  inventoryItemId: 7,
  itemName: 'Rabies vaccine',
  isControlled: false,
  lotNumber: '4471',
  expirationDate: '2027-01-31',
  branchId: 1,
  branchName: 'Kingfield Office',
  branchLocationId: 3,
  locationName: 'Main',
  quantityOnHand: 6,
  startingQuantity: 25,
  lastDrawnAt: null,
  lastMovedAt: null,
  receivedAt: '2026-08-01T00:00:00Z',
  flags: [{ type: 'skipped_over', reason: 'Lot 4471 skipped 3 times since Oct 2' }],
  ...over,
});

const renderPage = () =>
  render(
    <MemoryRouter>
      <InventoryStaleLotsReportPage />
    </MemoryRouter>
  );

beforeEach(() => {
  perms.keys = [];
  listStaleLots.mockReset().mockResolvedValue({
    rows: [
      row({}),
      row({
        lotId: 2,
        inventoryItemId: 8,
        itemName: 'Ketamine',
        isControlled: true,
        lotNumber: 'K-9',
        branchId: 2,
        branchName: 'Uptown Office',
        flags: [{ type: 'nearly_empty', reason: 'Lot K-9 has 1 left; last drawn 20 days ago' }],
      }),
    ],
    thresholds: {},
  });
  addWeeklyCountItems.mockReset().mockResolvedValue({ added: 1, alreadyOnSheet: 0, notCountable: 0 });
});

describe('CAT-10 stale lots report', () => {
  it('shows each flagged lot with the reason', async () => {
    renderPage();
    expect(await screen.findByText(/Lot 4471 skipped 3 times since Oct 2/)).toBeInTheDocument();
    expect(screen.getByText(/Lot K-9 has 1 left/)).toBeInTheDocument();
    expect(screen.getAllByText('Skipped over').length).toBeGreaterThan(1); // the filter and the row
    expect(screen.getByText('2 flagged lots')).toBeInTheDocument();
    // No weekly-count buttons without the permission.
    expect(screen.queryByRole('button', { name: /Add to weekly count/ })).toBeNull();
  });

  it('sends the office, flag and controlled-only filters to the API', async () => {
    renderPage();
    await screen.findByText(/Lot 4471/);
    fireEvent.change(screen.getByLabelText('Office'), { target: { value: '2' } });
    await waitFor(() =>
      expect(listStaleLots).toHaveBeenLastCalledWith(1, {
        branchId: 2,
        flag: undefined,
        controlledOnly: false,
      })
    );
    fireEvent.change(screen.getByLabelText('Flag'), { target: { value: 'nearly_empty' } });
    fireEvent.click(screen.getByLabelText('Controlled only'));
    await waitFor(() =>
      expect(listStaleLots).toHaveBeenLastCalledWith(1, {
        branchId: 2,
        flag: 'nearly_empty',
        controlledOnly: true,
      })
    );
  });

  it('adds one lot, or a selection across offices, to the weekly count when allowed', async () => {
    perms.keys = ['inventory.count.add_weekly'];
    renderPage();
    await screen.findByText(/Lot 4471/);
    fireEvent.click(screen.getAllByRole('button', { name: 'Add to weekly count' })[0]!);
    await waitFor(() => expect(addWeeklyCountItems).toHaveBeenCalledWith(1, 1, { inventoryItemIds: [7] }));
    expect(await screen.findByText(/Added 1 item to the weekly count/)).toBeInTheDocument();

    addWeeklyCountItems.mockClear();
    fireEvent.click(screen.getByLabelText('Select all'));
    fireEvent.click(screen.getByRole('button', { name: /Add selected to weekly count \(2\)/ }));
    await waitFor(() => expect(addWeeklyCountItems).toHaveBeenCalledTimes(2));
    expect(addWeeklyCountItems).toHaveBeenCalledWith(1, 1, { inventoryItemIds: [7] });
    expect(addWeeklyCountItems).toHaveBeenCalledWith(1, 2, { inventoryItemIds: [8] });
  });
});

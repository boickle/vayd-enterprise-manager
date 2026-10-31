/**
 * INV-07-9: the inventory reports load for a mostly uncounted practice (owner decision D4):
 * shelves at 0 or below, items with no balance row, no lots, empty percentages.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';
import InventoryTotalsPage from './InventoryTotalsPage';
import InventoryActivityPage from './InventoryActivityPage';
import InventoryShrinkReportPage from './InventoryShrinkReportPage';
import InventoryStockRequestsPage from './InventoryStockRequestsPage';

vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ token: null }) }));
vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ token: null }) }));
vi.mock('../utils/practiceIdFromToken', () => ({ resolvePracticeIdFromToken: () => 1 }));
vi.mock('../utils/useCountReviewBranches', async (orig) => ({
  ...(await orig<typeof import('../utils/useCountReviewBranches')>()),
  useCountReviewBranches: () => ({
    branches: [{ id: 4, name: 'Kingfield Office', isActive: true }],
    loading: false,
    error: null,
  }),
}));

const office = { id: 4, practiceId: 1, name: 'Kingfield Office', isActive: true, isDefault: true };
const shelves = [
  { id: 41, branchId: 4, code: 'MAIN', name: 'Main', isDefault: true, isActive: true },
  { id: 42, branchId: 4, code: 'CAR', name: 'Car', isDefault: false, isActive: true },
];

vi.mock('../api/branchInventory', () => ({
  listPracticeBranches: vi.fn(async () => [office]),
  listInventoryBranchLocations: vi.fn(async () => shelves),
  listInventoryMovements: vi.fn(async () => ({
    total: 2,
    rows: [
      {
        id: 1,
        movementType: 'sold',
        inventoryItemId: 9,
        quantity: 60,
        fromBranchLocationId: 41,
        fromQuantityBefore: 0,
        fromQuantityAfter: -60,
        inventoryItem: { id: 9, name: 'Carprofen 100 mg' },
        fromBranchLocation: { id: 41, name: 'Main' },
        movedByEmployee: null,
        movedByUser: null,
        created: '2026-10-28T15:00:00.000Z',
      },
      {
        id: 2,
        movementType: 'opening_increase',
        inventoryItemId: 9,
        quantity: 210,
        toBranchLocationId: 41,
        toQuantityBefore: -60,
        toQuantityAfter: 150,
        inventoryItem: null,
        created: '2026-10-28T16:00:00.000Z',
      },
    ],
  })),
  listBranchParLevels: vi.fn(async () => ({
    branchId: 4,
    locations: shelves,
    items: [
      {
        inventoryItemId: 9,
        name: 'Carprofen 100 mg',
        code: null,
        reorderPoint: null,
        parLevel: null,
        quantityOnHandTotal: -60,
        belowPar: false,
        locations: [
          {
            branchLocationId: 41,
            code: 'MAIN',
            name: 'Main',
            isDefault: true,
            quantityOnHand: -60,
            parLevel: null,
            belowPar: false,
          },
        ],
      },
    ],
  })),
  getInventoryBranchStock: vi.fn(async () => ({ locations: [] })),
}));
vi.mock('../api/inventoryTools', () => ({
  getInventoryCostSummary: vi.fn(async () => ({
    branchId: 4,
    totalExtendedCost: -18,
    byLocation: [
      { branchLocationId: 41, code: 'MAIN', name: 'Main', extendedCost: -18, quantityOnHand: -60 },
      { branchLocationId: 42, code: 'CAR', name: 'Car', extendedCost: 0 },
    ],
  })),
}));
vi.mock('../api/inventoryCounts', async (orig) => ({
  ...(await orig<typeof import('../api/inventoryCounts')>()),
  getCountReviewOffices: vi.fn(async () => [4]),
  getShrinkSummary: vi.fn(async () => ({
    fromDate: '2026-10-01',
    toDate: '2026-10-31',
    branchId: 4,
    thresholds: { A: { units: 1, usd: 5 }, B: { units: 2, usd: 10 }, C: { units: 5, usd: 25 } },
    counts: {
      itemsCounted: 0,
      firstCounts: 3,
      exact: 0,
      withinTolerance: 0,
      flagged: 0,
      accuracyPct: null,
      exactPct: null,
      lossUsd: 0,
      gainUsd: 0,
      netUsd: 0,
    },
    completion: { due: 0, done: 0, pct: null },
    waste: { usd: 0, events: 0 },
    inventoryValueUsd: -18,
    shrinkUsd: 0,
    shrinkPct: null,
    byClass: [],
    byLocation: [],
    topLosses: [],
    repeatOffenders: [],
  })),
}));
vi.mock('../api/inventoryOps', async (orig) => ({
  ...(await orig<typeof import('../api/inventoryOps')>()),
  listStockRequests: vi.fn(async () => [
    {
      id: 7,
      practiceId: 1,
      kind: 'order',
      status: 'open',
      branchId: 4,
      branchName: 'Kingfield Office',
      branchLocationId: 41,
      locationName: 'Main',
      toBranchId: null,
      toBranchName: null,
      toBranchLocationId: null,
      toLocationName: null,
      inventoryItemId: 9,
      itemName: 'Carprofen 100 mg',
      itemCode: null,
      quantity: 240,
      requestedByEmployeeId: null,
      requestedByName: null,
      created: '2026-10-28T15:00:00.000Z',
      resolvedAt: null,
      packs: null,
    },
  ]),
  listPurchaseOrders: vi.fn(async () => []),
  listSuppliers: vi.fn(async () => []),
  resolveStockRequest: vi.fn(),
}));
vi.mock('../utils/syncFillList', async (orig) => ({
  ...(await orig<typeof import('../utils/syncFillList')>()),
  syncStockListsFromPars: vi.fn(async () => ({
    requests: [],
    fillSources: [],
    orderBreakdowns: [],
  })),
}));
vi.mock('../components/inventory/ParTransferModal', () => ({ default: () => null }));
vi.mock('../components/inventory/PlaceOrderModal', () => ({ default: () => null }));

const page = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe('INV-07-9: reports load while shelves are uncounted', () => {
  it('Totals shows a negative office value', async () => {
    page(<InventoryTotalsPage />);
    expect(await screen.findByText(/Total extended cost/)).toBeInTheDocument();
    expect(screen.getAllByText(/18\.00/).length).toBeGreaterThan(0);
    expect(screen.getByText('Car')).toBeInTheDocument();
  });

  it('Activity lists a draw below zero and an opening count', async () => {
    page(<InventoryActivityPage />);
    expect((await screen.findAllByText(/Carprofen 100 mg/)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/-60/).length).toBeGreaterThan(0);
  });

  it('Shrink loads with no counts yet and a negative stock value', async () => {
    page(<InventoryShrinkReportPage />);
    expect((await screen.findAllByText(/Kingfield Office|Shrink/)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/NaN|undefined/)).not.toBeInTheDocument();
  });

  it('Order List loads a row for an item that is below zero', async () => {
    page(<InventoryStockRequestsPage kind="order" />);
    expect((await screen.findAllByText(/Carprofen 100 mg/)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/NaN|undefined/)).not.toBeInTheDocument();
  });
});

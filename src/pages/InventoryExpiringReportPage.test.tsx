/** INV-04-8: expired stock on a shelf gets its own section with a way to log it as waste. */
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';
import InventoryExpiringReportPage from './InventoryExpiringReportPage';

vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ token: null }) }));
vi.mock('../utils/practiceIdFromToken', () => ({ resolvePracticeIdFromToken: () => 1 }));
vi.mock('../api/branchInventory', () => ({
  listPracticeBranches: vi.fn(async () => []),
  listInventoryBranchLocations: vi.fn(async () => []),
  listInventoryLots: vi.fn(async () => []),
  listExpiringInventoryLots: vi.fn(async () => ({
    withinDays: 183,
    fromDate: '2026-10-28',
    toDate: '2027-04-29',
    rows: [
      {
        inventoryItemId: 7,
        name: 'Rabies vaccine',
        code: null,
        soonestExpiration: '2026-10-01',
        totalQty: 5,
        expired: true,
        locations: [
          {
            lotId: 11,
            branchId: 1,
            branchName: 'Kingfield Office',
            branchLocationId: 3,
            locationName: 'Main',
            locationCode: 'MAIN',
            lotNumber: 'R-OLD',
            serialNumber: null,
            expirationDate: '2026-10-01',
            quantityOnHand: 2,
            expired: true,
          },
          {
            lotId: 12,
            branchId: 1,
            branchName: 'Kingfield Office',
            branchLocationId: 3,
            locationName: 'Main',
            locationCode: 'MAIN',
            lotNumber: 'R-SOON',
            serialNumber: null,
            expirationDate: '2026-11-07',
            quantityOnHand: 3,
            expired: false,
          },
        ],
      },
    ],
  })),
}));

describe('INV-04-8: Expiring report', () => {
  it('lists expired stock under "Expired on shelf" with a link to Waste / Adjust', async () => {
    render(
      <MemoryRouter>
        <InventoryExpiringReportPage />
      </MemoryRouter>
    );

    const section = await screen.findByRole('region', { name: 'Expired on shelf' });
    expect(within(section).getByText('R-OLD')).toBeInTheDocument();
    expect(within(section).queryByText('R-SOON')).not.toBeInTheDocument();
    expect(within(section).getByRole('link', { name: /Waste \/ Adjust/ })).toHaveAttribute(
      'href',
      '/schedule/inventory/waste'
    );
    // The expiring table keeps the lot that is still good, counted on its own.
    expect(screen.getByText('2026-11-07')).toBeInTheDocument();
  });
});

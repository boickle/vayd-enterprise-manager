/**
 * INV-04-7: at checkout, visit use and mail fills (owner decision D2) an expired lot is shown
 * greyed with its date but can't be picked, and the one good lot is picked for staff.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import StockLotPicker from './StockLotPicker';
import type { InventoryLotBalance } from '../../api/branchInventory';

const lots: InventoryLotBalance[] = [
  {
    id: 1,
    inventoryItemId: 9,
    branchId: 1,
    branchName: 'Office',
    branchLocationId: 5,
    locationCode: 'MAIN',
    locationName: 'Main',
    lotNumber: 'OLD1',
    serialNumber: null,
    expirationDate: '2026-10-01',
    quantityOnHand: 3,
    expired: true,
  },
  {
    id: 2,
    inventoryItemId: 9,
    branchId: 1,
    branchName: 'Office',
    branchLocationId: 5,
    locationCode: 'MAIN',
    locationName: 'Main',
    lotNumber: 'NEW2',
    serialNumber: null,
    expirationDate: '2027-06-30',
    quantityOnHand: 10,
    expired: false,
  },
];

vi.mock('../../api/branchInventory', () => ({
  listInventoryLots: vi.fn(async () => lots),
  getUncountedShelfLot: vi.fn(),
}));
vi.mock('./AddInventoryLotModal', () => ({ default: () => null }));

describe('INV-04-7: lot picker in use mode', () => {
  it('shows the expired lot greyed and not selectable, and auto-selects the current lot', async () => {
    const onChange = vi.fn();
    render(
      <StockLotPicker
        forUse
        practiceId={1}
        inventoryItemId={9}
        branchId={1}
        locationId={5}
        selectedLotId={null}
        onChange={onChange}
      />
    );

    const expired = await screen.findByRole('option', { name: /Lot OLD1 · Expired Oct 1/ });
    expect(expired).toBeDisabled();
    expect(expired).toHaveClass('stock-lot-picker__expired');
    expect(screen.getByRole('option', { name: /Lot NEW2/ })).not.toBeDisabled();
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith({
        lotId: 2,
        lotNumber: 'NEW2',
        expirationDate: '2027-06-30',
      })
    );
    expect(onChange).not.toHaveBeenCalledWith(expect.objectContaining({ lotId: 1 }));
    expect(screen.getByText(/Expired lots can't be used/)).toBeInTheDocument();
  });

  it('Waste / Adjust (not use mode) can still pick an expired lot', async () => {
    render(
      <StockLotPicker
        practiceId={1}
        inventoryItemId={9}
        locationId={5}
        selectedLotId={null}
        onChange={vi.fn()}
      />
    );
    const expired = await screen.findByRole('option', { name: /Lot OLD1 · Expired Oct 1/ });
    expect(expired).not.toBeDisabled();
  });
});

/**
 * Owner decisions (Oct 30, 2026): a controlled drug's lot comes from the doctor's controlled drug
 * location (their safe); staff can take one from another shelf, which the report flags.
 */
describe('controlled drug: the doctor’s safe first, another shelf if needed', () => {
  it('lists the safe’s lots, then every shelf on "Another shelf…", and back', async () => {
    const api = await import('../../api/branchInventory');
    const list = vi.mocked(api.listInventoryLots);
    list.mockClear();
    render(
      <StockLotPicker
        forUse
        practiceId={1}
        inventoryItemId={9}
        branchId={1}
        locationId={5}
        otherShelvesFrom="HC home → Main"
        selectedLotId={2}
        onChange={() => undefined}
      />
    );
    expect(await screen.findByText(/From HC home → Main/)).toBeInTheDocument();
    await waitFor(() => expect(list).toHaveBeenLastCalledWith(1, 9, expect.objectContaining({ locationId: 5 })));

    (await screen.findByRole('button', { name: 'Another shelf…' })).click();
    await waitFor(() =>
      expect(list).toHaveBeenLastCalledWith(1, 9, expect.not.objectContaining({ locationId: 5 }))
    );
    expect(await screen.findByText(/Every shelf/)).toBeInTheDocument();
    (await screen.findByRole('button', { name: 'Back to HC home → Main' })).click();
    await waitFor(() => expect(list).toHaveBeenLastCalledWith(1, 9, expect.objectContaining({ locationId: 5 })));
  });
});

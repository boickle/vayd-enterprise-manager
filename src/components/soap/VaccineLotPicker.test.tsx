/**
 * Found in the inventory end-to-end pass (INV-04-9): vaccine doses use their own lot picker, and
 * it still offered expired lots. Owner decision D2: shown, but can't be picked.
 */
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import VaccineLotPicker from './VaccineLotPicker';

vi.mock('../../api/branchInventory', () => ({
  getEmployeeBranches: vi.fn(async () => []),
  listPracticeBranches: vi.fn(async () => [{ id: 1, name: 'Kingfield Office' }]),
  listInventoryLots: vi.fn(async () => [
    {
      id: 1,
      inventoryItemId: 7,
      branchId: 1,
      branchName: 'Kingfield Office',
      branchLocationId: 5,
      locationCode: 'MAIN',
      locationName: 'Main',
      lotNumber: 'OLD',
      serialNumber: null,
      expirationDate: '2026-10-01',
      quantityOnHand: 4,
      expired: true,
    },
    {
      id: 2,
      inventoryItemId: 7,
      branchId: 1,
      branchName: 'Kingfield Office',
      branchLocationId: 5,
      locationCode: 'MAIN',
      locationName: 'Main',
      lotNumber: 'NEW',
      serialNumber: null,
      expirationDate: '2029-06-30',
      quantityOnHand: 4,
      expired: false,
    },
  ]),
}));
vi.mock('../../api/employeeWorkdayActuals', () => ({
  fetchEmployeeWorkdayActualByDate: vi.fn(async () => null),
}));
vi.mock('../inventory/AddInventoryLotModal', () => ({ default: () => null }));

it('shows an expired vaccine lot greyed out and not selectable', async () => {
  render(
    <VaccineLotPicker
      practiceId={1}
      inventoryItemId={7}
      branchId={1}
      locationId={5}
      selectedLotId={null}
      onSelectLot={vi.fn()}
    />
  );
  const old = await screen.findByRole('option', { name: /Lot OLD · Expired Oct 1/ });
  expect(old).toBeDisabled();
  expect(screen.getByRole('option', { name: /Lot NEW/ })).not.toBeDisabled();
  expect(screen.getByText(/Expired lots can't be given/)).toBeInTheDocument();
});

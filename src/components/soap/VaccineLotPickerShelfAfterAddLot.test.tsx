/**
 * Add lot records one bottle; it doesn't count the shelf. Until the shelf's first count, the
 * other bottles there can still go to "Existing stock — shelf not counted yet" (Nov 11, 2026).
 */
import { render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import VaccineLotPicker from './VaccineLotPicker';

const counted = { value: false };
const getShelfCountStatus = vi.fn(async () => ({ counted: counted.value }));

vi.mock('../../api/branchInventory', () => ({
  getEmployeeBranches: vi.fn(async () => []),
  listPracticeBranches: vi.fn(async () => [{ id: 1, name: 'Kingfield Office' }]),
  listInventoryLots: vi.fn(async () => [
    {
      id: 12,
      inventoryItemId: 455,
      branchId: 1,
      branchLocationId: 5,
      lotNumber: 'CP-4471',
      expirationDate: '2027-12-31',
      quantityOnHand: 30,
    },
  ]),
  getUncountedShelfLot: vi.fn(),
  getShelfCountStatus: (...args: unknown[]) => getShelfCountStatus(...(args as [])),
}));
vi.mock('../../api/employeeWorkdayActuals', () => ({
  fetchEmployeeWorkdayActualByDate: vi.fn(async () => null),
}));
vi.mock('../inventory/AddInventoryLotModal', () => ({ default: () => null }));

function renderPicker() {
  return render(
    <VaccineLotPicker
      practiceId={1}
      inventoryItemId={455}
      branchId={1}
      locationId={5}
      selectedLotId={null}
      onSelectLot={vi.fn()}
      offerUncountedShelf
    />
  );
}

it('still offers existing stock after a lot was added, until the first count', async () => {
  counted.value = false;
  renderPicker();
  await screen.findByRole('option', { name: /CP-4471/ });
  await screen.findByRole('option', { name: 'Existing stock — shelf not counted yet' });
  expect(getShelfCountStatus).toHaveBeenCalledWith(1, 455, 5);
});

it('stops offering it once the shelf has had its first count', async () => {
  counted.value = true;
  getShelfCountStatus.mockClear();
  renderPicker();
  await screen.findByRole('option', { name: /CP-4471/ });
  await waitFor(() => expect(getShelfCountStatus).toHaveBeenCalled());
  expect(screen.queryByRole('option', { name: /shelf not counted yet/ })).toBeNull();
});

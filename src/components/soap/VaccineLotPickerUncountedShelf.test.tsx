/**
 * Before a shelf's first count it has no lots (only controlled drugs are counted at launch), so a
 * 4dx kit or a linked medication offers "Existing stock — shelf not counted yet" (the shelf's
 * no-lot-recorded row). Vaccines don't get it; most need their real lot #.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import VaccineLotPicker from './VaccineLotPicker';

const getUncountedShelfLot = vi.fn(async () => ({
  id: 99,
  lotNumber: 'UNASSIGNED',
  expirationDate: null,
  quantityOnHand: 0,
}));

vi.mock('../../api/branchInventory', () => ({
  getEmployeeBranches: vi.fn(async () => []),
  listPracticeBranches: vi.fn(async () => [{ id: 1, name: 'Kingfield Office' }]),
  listInventoryLots: vi.fn(async () => []),
  getUncountedShelfLot: (...args: unknown[]) => getUncountedShelfLot(...(args as [])),
}));
vi.mock('../../api/employeeWorkdayActuals', () => ({
  fetchEmployeeWorkdayActualByDate: vi.fn(async () => null),
}));
vi.mock('../inventory/AddInventoryLotModal', () => ({ default: () => null }));

it('offers existing stock on a shelf with no lots and picks the shelf’s no-lot row', async () => {
  const onSelectLot = vi.fn();
  render(
    <VaccineLotPicker
      practiceId={1}
      inventoryItemId={455}
      branchId={1}
      locationId={5}
      selectedLotId={null}
      onSelectLot={onSelectLot}
      offerUncountedShelf
    />
  );
  await screen.findByRole('option', { name: 'Existing stock — shelf not counted yet' });

  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'shelf' } });

  await waitFor(() => expect(onSelectLot).toHaveBeenCalled());
  expect(getUncountedShelfLot).toHaveBeenCalledWith(1, 455, 5);
  expect(onSelectLot.mock.calls[0][0]).toMatchObject({ id: 99, lotNumber: 'UNASSIGNED' });
});

it('shows the picked no-lot row as "Existing stock (no lot recorded)"', async () => {
  render(
    <VaccineLotPicker
      practiceId={1}
      inventoryItemId={455}
      branchId={1}
      locationId={5}
      selectedLotId={99}
      selectedLotNumber="UNASSIGNED"
      onSelectLot={vi.fn()}
      offerUncountedShelf
    />
  );
  const row = await screen.findByRole('option', { name: 'Existing stock (no lot recorded)' });
  expect((row as HTMLOptionElement).selected).toBe(true);
});

it('does not offer it unless asked (vaccines)', async () => {
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
  await screen.findByRole('option', { name: /No lots with stock/ });
  expect(screen.queryByRole('option', { name: /Existing stock/ })).toBeNull();
});

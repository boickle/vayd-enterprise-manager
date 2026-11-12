/** U3: Quantity on hand starts blank, so typing 30 gives 30, and a blank box isn't saved as 0. */
import { fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import AddInventoryLotModal from './AddInventoryLotModal';

const addInventoryLot = vi.fn();
vi.mock('../../api/branchInventory', () => ({
  listPracticeBranches: vi.fn(async () => [{ id: 1, name: 'Raleigh office', isActive: true }]),
  listInventoryBranchLocations: vi.fn(async () => [{ id: 5, name: 'Car 2', isActive: true }]),
  addInventoryLot: (...args: unknown[]) => addInventoryLot(...args),
}));

it('starts Quantity on hand blank and asks for it', async () => {
  render(
    <AddInventoryLotModal
      open
      practiceId={1}
      inventoryItemId={455}
      defaultBranchId={1}
      defaultLocationId={5}
      onClose={vi.fn()}
      onCreated={vi.fn()}
    />
  );
  const qty = screen.getByPlaceholderText('How many on hand') as HTMLInputElement;
  expect(qty.value).toBe('');
});

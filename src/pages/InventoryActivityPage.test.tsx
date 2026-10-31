/**
 * Owner decisions (Oct 30, 2026): activity can be narrowed to controlled drugs; someone with the
 * full log at their own office (an inventory manager) sees only that office in full, and any
 * office where they hold just the controlled-drug log (Controlled Substances Director, vets) is
 * controlled drugs only.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import InventoryActivityPage from './InventoryActivityPage';

const listInventoryMovements = vi.fn();
const offices = vi.hoisted(() => ({ value: {} as Record<string, number[] | 'all'> }));
vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ token: null }) }));
vi.mock('../utils/practiceIdFromToken', () => ({ resolvePracticeIdFromToken: () => 1 }));
vi.mock('../api/permissions', () => ({
  fetchMyOffices: async (_p: number, key: string) => offices.value[key] ?? [],
}));
vi.mock('../api/branchInventory', () => ({
  listPracticeBranches: async () => [
    { id: 1, name: 'Main', isDefault: true },
    { id: 119, name: 'HC home' },
    { id: 7, name: 'North' },
  ],
  listInventoryBranchLocations: async () => [],
  listInventoryMovements: (...a: unknown[]) => listInventoryMovements(...a),
}));

beforeEach(() => {
  listInventoryMovements.mockReset().mockResolvedValue({ total: 0, rows: [] });
});

it('anyone with the full log everywhere can narrow to controlled drugs received', async () => {
  offices.value = { 'inventory.activity_log.view': 'all' };
  render(<InventoryActivityPage />);
  await waitFor(() => expect(listInventoryMovements).toHaveBeenCalled());
  expect(screen.getByText('Inventory Activity')).toBeInTheDocument();

  fireEvent.click(screen.getByLabelText('Controlled drugs only'));
  fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'receive' } });
  await waitFor(() =>
    expect(listInventoryMovements).toHaveBeenLastCalledWith(
      1,
      1,
      expect.objectContaining({ controlledOnly: true, movementType: 'receive' })
    )
  );
});

it('the Controlled Substances Director sees every office, controlled drugs only', async () => {
  offices.value = { 'inventory.activity_log.controlled': 'all' };
  render(<InventoryActivityPage />);
  expect(await screen.findByText('Controlled Drug Activity')).toBeInTheDocument();
  expect(screen.queryByLabelText('Controlled drugs only')).toBeNull();
  await waitFor(() =>
    expect(listInventoryMovements).toHaveBeenLastCalledWith(1, 1, expect.objectContaining({ controlledOnly: true }))
  );
  expect(screen.getAllByRole('option', { name: 'North' })).toHaveLength(1);
});

it('an inventory manager for her own location sees it in full, and other offices controlled-only', async () => {
  offices.value = {
    'inventory.activity_log.view': [119],
    'inventory.activity_log.controlled': 'all',
  };
  render(<InventoryActivityPage />);
  await waitFor(() => expect(listInventoryMovements).toHaveBeenCalled());
  const office = screen.getByLabelText('Office');
  fireEvent.change(office, { target: { value: '119' } });
  await waitFor(() =>
    expect(listInventoryMovements).toHaveBeenLastCalledWith(1, 119, expect.not.objectContaining({ controlledOnly: true }))
  );
  expect(screen.getByText('Inventory Activity')).toBeInTheDocument();

  fireEvent.change(office, { target: { value: '1' } });
  await waitFor(() =>
    expect(listInventoryMovements).toHaveBeenLastCalledWith(1, 1, expect.objectContaining({ controlledOnly: true }))
  );
});

it('an inventory manager for one office with no controlled-drug log sees only that office', async () => {
  offices.value = { 'inventory.activity_log.view': [119] };
  render(<InventoryActivityPage />);
  await waitFor(() => expect(listInventoryMovements).toHaveBeenCalledWith(1, 119, expect.anything()));
  expect(screen.queryByRole('option', { name: 'Main' })).toBeNull();
  expect(screen.getByRole('option', { name: 'HC home' })).toBeInTheDocument();
});

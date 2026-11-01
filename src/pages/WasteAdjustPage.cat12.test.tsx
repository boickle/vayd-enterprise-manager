/** CAT-12 on Waste / Adjust: controlled items need a disposal method and can name a witness. */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import WasteAdjustPage from './WasteAdjustPage';

const recordWaste = vi.fn();
const item = vi.hoisted(() => ({ controlled: true }));
vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ token: null, employeeId: '4' }) }));
vi.mock('../utils/practiceIdFromToken', () => ({ resolvePracticeIdFromToken: () => 1 }));
vi.mock('../utils/appDialog', () => ({ appPrompt: vi.fn() }));
vi.mock('../api/appointmentSettings', () => ({
  fetchAllEmployees: async () => [
    { id: 4, firstName: 'Pat', lastName: 'Lee' },
    { id: 9, firstName: 'Sam', lastName: 'Rivera' },
  ],
}));
vi.mock('../api/inventoryOps', () => ({
  getWasteAdmin: async () => ({
    reasons: [{ code: 'broken', label: 'Broken', requiresDisposalMethod: 'no', isActive: true }],
    methods: [{ code: 'pharmaceutical', label: 'Pharmaceutical waste', isActive: true }],
  }),
  recordWaste: (...a: unknown[]) => recordWaste(...a),
}));
vi.mock('../api/branchInventory', () => ({
  listPracticeBranches: async () => [{ id: 3, name: 'Main', isDefault: true }],
  listInventoryBranchLocations: async () => [{ id: 9, name: 'Truck 1' }],
}));
vi.mock('../api/quantityPriceBreaks', () => ({
  searchItems: async () => [{ itemType: 'inventory', id: 55, name: 'Thing' }],
}));
vi.mock('../hooks/useStockItemGroups', () => ({
  useStockItemGroups: (results: unknown[]) =>
    results.length
      ? [{ stockItemId: 55, label: 'Thing', viaNames: [], item: { name: 'Thing', trackLots: false, isControlled: item.controlled } }]
      : [],
  loadInventoryItem: async () => ({ name: 'Thing', trackLots: false, isControlled: item.controlled }),
}));
vi.mock('../components/inventory/StockLotPicker', () => ({ default: () => null }));

beforeEach(() => recordWaste.mockReset().mockResolvedValue({ id: 1 }));

async function pick() {
  render(<WasteAdjustPage />);
  fireEvent.change(await screen.findByPlaceholderText('Search item'), { target: { value: 'thi' } });
  fireEvent.click(await screen.findByRole('button', { name: /Thing/ }));
}

it('controlled item: disposal is required and the witness picker is there', async () => {
  item.controlled = true;
  await pick();
  expect(screen.getByText('Required for controlled drugs.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Record adjustment' }));
  expect(await screen.findByText('Disposal method is required')).toBeInTheDocument();
  expect(recordWaste).not.toHaveBeenCalled();

  fireEvent.click(screen.getByLabelText('Pharmaceutical waste'));
  await waitFor(() => expect(screen.getByRole('option', { name: 'Sam Rivera' })).toBeInTheDocument());
  expect(screen.queryByRole('option', { name: 'Pat Lee' })).toBeNull();
  fireEvent.change(screen.getByLabelText('Witness (optional)'), { target: { value: '9' } });
  fireEvent.click(screen.getByRole('button', { name: 'Record adjustment' }));
  await waitFor(() =>
    expect(recordWaste).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ disposalMethodCode: 'pharmaceutical', witnessEmployeeId: 9 })
    )
  );
});

it('non-controlled item: no disposal needed for this reason, no witness picker', async () => {
  item.controlled = false;
  await pick();
  expect(screen.queryByLabelText('Witness (optional)')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Record adjustment' }));
  await waitFor(() => expect(recordWaste).toHaveBeenCalled());
  expect(recordWaste.mock.calls[0][1]).not.toHaveProperty('witnessEmployeeId');
});

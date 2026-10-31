/**
 * Owner decisions (Oct 30, 2026), controlled-drug launch: "Other Correction" and disposal
 * "Other" need a written explanation that's saved; reverse distribution is offered only for
 * an expired controlled drug.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import WasteAdjustPage, { disposalMethodsFor } from './WasteAdjustPage';

const recordWaste = vi.fn();
const appPrompt = vi.fn();
const METHODS = [
  { code: 'pharmaceutical', label: 'Pharmaceutical waste', isActive: true },
  { code: 'reverse_distribution', label: 'Reverse Distribution (Controlled Drugs Only)', isActive: true },
  { code: 'other', label: 'Other', isActive: true },
];
vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ token: null }) }));
vi.mock('../utils/practiceIdFromToken', () => ({ resolvePracticeIdFromToken: () => 1 }));
vi.mock('../utils/appDialog', () => ({ appPrompt: (...a: unknown[]) => appPrompt(...a) }));
vi.mock('../api/inventoryOps', () => ({
  getWasteAdmin: async () => ({
    reasons: [
      { code: 'expired', label: 'Expired', requiresDisposalMethod: 'yes', isActive: true },
      { code: 'other_correction', label: 'Other Correction', requiresDisposalMethod: 'no', isActive: true },
    ],
    methods: METHODS,
  }),
  recordWaste: (...a: unknown[]) => recordWaste(...a),
}));
vi.mock('../api/branchInventory', () => ({
  listPracticeBranches: async () => [{ id: 3, name: 'Main', isDefault: true }],
  listInventoryBranchLocations: async () => [{ id: 9, name: 'Truck 1' }],
}));
vi.mock('../api/quantityPriceBreaks', () => ({
  searchItems: async () => [{ itemType: 'inventory', id: 55, name: 'Buprenorphine' }],
}));
vi.mock('../hooks/useStockItemGroups', () => ({
  useStockItemGroups: (results: unknown[]) =>
    results.length
      ? [
          {
            stockItemId: 55,
            label: 'Buprenorphine',
            viaNames: [],
            item: { name: 'Buprenorphine', trackLots: false, isControlled: true },
          },
        ]
      : [],
  loadInventoryItem: async () => ({ name: 'Buprenorphine', trackLots: false, isControlled: true }),
}));
vi.mock('../components/inventory/StockLotPicker', () => ({ default: () => null }));

beforeEach(() => {
  recordWaste.mockReset().mockResolvedValue({ id: 1 });
  appPrompt.mockReset();
});

async function pickControlledItem() {
  render(<WasteAdjustPage />);
  fireEvent.change(await screen.findByPlaceholderText('Search item'), { target: { value: 'bup' } });
  fireEvent.click(await screen.findByRole('button', { name: /Buprenorphine/ }));
}

it('offers reverse distribution only for an expired controlled drug', () => {
  const codes = (reason: string, controlled: boolean) =>
    disposalMethodsFor(METHODS, reason, controlled).map((m) => m.code);
  expect(codes('expired', true)).toContain('reverse_distribution');
  expect(codes('expired', false)).not.toContain('reverse_distribution');
  expect(codes('damaged', true)).not.toContain('reverse_distribution');
});

it('asks why for "Other Correction" and saves the explanation with the adjustment', async () => {
  await pickControlledItem();
  appPrompt.mockResolvedValue('Count was entered on the wrong shelf');
  fireEvent.click(screen.getByLabelText('Other Correction'));
  expect(await screen.findByText(/Why: Count was entered on the wrong shelf/)).toBeInTheDocument();
  expect(appPrompt).toHaveBeenCalledWith(expect.objectContaining({ requireReason: true }));

  fireEvent.click(screen.getByRole('button', { name: 'Record adjustment' }));
  await waitFor(() =>
    expect(recordWaste).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        reasonCode: 'other_correction',
        explanation: 'Count was entered on the wrong shelf',
      })
    )
  );
});

it('keeps the previous reason when the explanation is cancelled', async () => {
  await pickControlledItem();
  appPrompt.mockResolvedValue(null);
  fireEvent.click(screen.getByLabelText('Other Correction'));
  await waitFor(() => expect(appPrompt).toHaveBeenCalled());
  expect(screen.getByLabelText('Expired')).toBeChecked();
  expect(screen.getByLabelText('Other Correction')).not.toBeChecked();
});

it('asks how for an "Other" disposal on an expired drug, and offers reverse distribution', async () => {
  await pickControlledItem();
  expect(screen.getByLabelText('Reverse Distribution (Controlled Drugs Only)')).toBeInTheDocument();
  appPrompt.mockResolvedValue('Taken by DEA-registered courier');
  fireEvent.click(screen.getByLabelText('Other'));
  expect(await screen.findByText(/How: Taken by DEA-registered courier/)).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Record adjustment' }));
  await waitFor(() =>
    expect(recordWaste).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        reasonCode: 'expired',
        disposalMethodCode: 'other',
        explanation: 'Taken by DEA-registered courier',
      })
    )
  );
});

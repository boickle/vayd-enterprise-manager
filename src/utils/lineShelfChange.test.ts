import { beforeEach, describe, expect, it, vi } from 'vitest';

const updateLine = vi.fn();
const patchInvoice = vi.fn();
const confirm = vi.fn();

vi.mock('../api/visitWorkflow', () => ({
  updateCounterInvoiceLine: (...a: unknown[]) => updateLine(...a),
  patchVisitInvoice: (...a: unknown[]) => patchInvoice(...a),
}));
vi.mock('./appDialog', () => ({ appConfirm: (...a: unknown[]) => confirm(...a) }));

import { changeLineShelf, setInvoiceShelf } from './lineShelfChange';
import type { VisitInvoice, VisitInvoiceLine } from '../api/visitWorkflow';

const line = (id: string, over: Partial<VisitInvoiceLine> = {}) =>
  ({ id, description: id, catalogItemType: 'inventory', ...over }) as VisitInvoiceLine;

const bravecto = line('bravecto', { inventoryLotBalanceId: 5 });
const butorphanol = line('butorphanol', { catalogIsControlled: true, controlledLocation: null });
const invoice = {
  id: 'inv',
  inventoryBranchId: 1,
  inventoryLocationId: 2,
  lines: [bravecto, butorphanol],
} as unknown as VisitInvoice;

const shelf = { branchId: 119, locationId: 252, name: 'HC home → Main' };

beforeEach(() => {
  vi.clearAllMocks();
  updateLine.mockImplementation(async () => invoice);
  patchInvoice.mockImplementation(async () => invoice);
});

describe('changeLineShelf', () => {
  it('moves a controlled drug alone, without asking', async () => {
    await changeLineShelf(invoice, butorphanol, shelf);
    expect(confirm).not.toHaveBeenCalled();
    expect(patchInvoice).not.toHaveBeenCalled();
    expect(updateLine).toHaveBeenCalledTimes(1);
    expect(updateLine).toHaveBeenCalledWith('inv', 'butorphanol', { inventoryLocationId: 252 });
  });

  it('"Just this item" changes only that item and leaves the invoice default alone', async () => {
    confirm.mockResolvedValue(false);
    await changeLineShelf(invoice, bravecto, shelf);
    expect(patchInvoice).not.toHaveBeenCalled();
    expect(updateLine).toHaveBeenCalledTimes(1);
    expect(updateLine).toHaveBeenCalledWith('inv', 'bravecto', { inventoryLocationId: 252 });
  });

  it('"All items" changes the invoice default, keeps the controlled drug where it was', async () => {
    confirm.mockResolvedValue(true);
    await changeLineShelf(invoice, bravecto, shelf);
    // The controlled drug was following the invoice (no safe), so it is pinned to the old shelf first.
    expect(updateLine).toHaveBeenNthCalledWith(1, 'inv', 'butorphanol', { inventoryLocationId: 2 });
    expect(patchInvoice).toHaveBeenCalledWith('inv', { inventoryBranchId: 119 });
    expect(patchInvoice).toHaveBeenCalledWith('inv', { inventoryLocationId: 252 });
    expect(updateLine).toHaveBeenCalledWith('inv', 'bravecto', { inventoryLocationId: null });
    expect(updateLine).not.toHaveBeenCalledWith('inv', 'butorphanol', { inventoryLocationId: null });
  });
});

describe('setInvoiceShelf', () => {
  it('"Only new items" keeps existing items on the old shelf', async () => {
    await setInvoiceShelf(invoice, { branchId: 1, locationId: 3 }, { moveExisting: false });
    expect(updateLine).toHaveBeenCalledWith('inv', 'bravecto', { inventoryLocationId: 2 });
    expect(updateLine).toHaveBeenCalledWith('inv', 'butorphanol', { inventoryLocationId: 2 });
    expect(patchInvoice).toHaveBeenCalledWith('inv', { inventoryLocationId: 3 });
  });
});

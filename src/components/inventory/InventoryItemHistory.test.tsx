import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import InventoryItemHistory from './InventoryItemHistory';

const listCatalogItemChanges = vi.fn();
const listInventoryItemHistory = vi.fn();

vi.mock('../../api/branchInventory', () => ({
  listCatalogItemChanges: (...a: unknown[]) => listCatalogItemChanges(...a),
  listInventoryItemHistory: (...a: unknown[]) => listInventoryItemHistory(...a),
}));

describe('InventoryItemHistory for procedures and labs (CAT-A5)', () => {
  it('reads the procedure history and shows old and new price with who', async () => {
    listCatalogItemChanges.mockResolvedValue({
      total: 1,
      rows: [
        {
          kind: 'change', id: 'c-1', at: '2026-11-01T12:00:00Z', branchId: null, branchName: null,
          who: 'Pat Manager', source: 'edit', field: 'price', label: 'Price', oldValue: '50', newValue: '60',
        },
      ],
    });
    render(<InventoryItemHistory practiceId={1} inventoryItemId={9} itemType="procedure" branches={[]} />);
    await waitFor(() => expect(screen.getByText('$50.00 → $60.00')).toBeTruthy());
    expect(screen.getByText('Pat Manager')).toBeTruthy();
    expect(listCatalogItemChanges).toHaveBeenCalledWith(1, 'procedure', 9, expect.anything());
    expect(listInventoryItemHistory).not.toHaveBeenCalled();
    expect(screen.queryByText('Stock movements')).toBeNull();
  });
});

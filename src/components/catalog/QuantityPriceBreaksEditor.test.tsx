import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import QuantityPriceBreaksEditor from './QuantityPriceBreaksEditor';
import * as api from '../../api/quantityPriceBreaks';

vi.mock('../../api/quantityPriceBreaks', () => ({
  createQuantityPriceBreak: vi.fn().mockResolvedValue({}),
  updateQuantityPriceBreak: vi.fn().mockResolvedValue({}),
  deleteQuantityPriceBreak: vi.fn().mockResolvedValue({}),
}));
vi.mock('../../utils/appDialog', () => ({ appConfirm: vi.fn().mockResolvedValue(true) }));

const brk = (id: number, low: number, high: number, isActive = true) =>
  ({
    id, created: '', updated: '', isActive, price: 10, markup: null,
    lowQuantity: low, highQuantity: high, inventoryItem: null, procedure: null, lab: null,
    practice: { id: 1, name: 'P' },
  }) as api.QuantityPriceBreak;

function renderEditor(breaks = [brk(1, 6, 11), brk(2, 12, 100), brk(3, 7, 8, false)]) {
  return render(
    <QuantityPriceBreaksEditor
      itemType="inventory"
      itemId={5}
      practiceId={1}
      item={{ id: 5, name: 'X', price: '14.26', code: null } as api.InventoryItem}
      priceBreaks={breaks}
      onChanged={() => undefined}
    />
  );
}

describe('QuantityPriceBreaksEditor range checks (CAT-A1)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('refuses to save an edit that overlaps another active break, naming it', () => {
    renderEditor();
    fireEvent.click(screen.getAllByText('Edit')[0]);
    const inputs = screen.getAllByRole('spinbutton');
    fireEvent.change(inputs[1], { target: { value: '13' } });
    fireEvent.click(screen.getByText('Save'));
    expect(screen.getByText(/overlaps the active price break 12-100/)).toBeTruthy();
    expect(api.updateQuantityPriceBreak).not.toHaveBeenCalled();
  });

  it('refuses to save an edit with low above high', () => {
    renderEditor();
    fireEvent.click(screen.getAllByText('Edit')[1]);
    const inputs = screen.getAllByRole('spinbutton');
    fireEvent.change(inputs[0], { target: { value: '200' } });
    fireEvent.click(screen.getByText('Save'));
    expect(screen.getByText(/Low Quantity must be <= High Quantity/)).toBeTruthy();
    expect(api.updateQuantityPriceBreak).not.toHaveBeenCalled();
  });

  it('saves an edit that stays clear, and ignores inactive breaks', async () => {
    renderEditor();
    fireEvent.click(screen.getAllByText('Edit')[0]);
    const inputs = screen.getAllByRole('spinbutton');
    fireEvent.change(inputs[1], { target: { value: '9' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(api.updateQuantityPriceBreak).toHaveBeenCalledTimes(1));
  });

  it('refuses to create a break that overlaps an active one', () => {
    renderEditor();
    fireEvent.click(screen.getByText('Add price break'));
    const [low, high, price] = screen.getAllByRole('spinbutton');
    fireEvent.change(low, { target: { value: '10' } });
    fireEvent.change(high, { target: { value: '15' } });
    fireEvent.change(price, { target: { value: '9' } });
    fireEvent.click(screen.getByText('Create price break'));
    expect(screen.getByText(/overlaps the active price break 6-11/)).toBeTruthy();
    expect(api.createQuantityPriceBreak).not.toHaveBeenCalled();
  });

  it('shows the API message when the server answers 400', async () => {
    vi.mocked(api.updateQuantityPriceBreak).mockRejectedValueOnce({
      response: { data: { message: 'Server says the range overlaps 12-100.' } },
    });
    renderEditor();
    fireEvent.click(screen.getAllByText('Edit')[0]);
    fireEvent.click(screen.getByText('Save'));
    expect(await screen.findByText('Server says the range overlaps 12-100.')).toBeTruthy();
  });
});

describe('QuantityPriceBreaksEditor while the item reloads (PRC-04 take, Nov 12)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists a new break at once and lets the next one be added before the reload finishes', async () => {
    vi.mocked(api.createQuantityPriceBreak).mockResolvedValueOnce({ ...brk(9, 1, 9), price: 9.5 });
    // The parent's reload never finishes: the editor must not wait for it.
    const onChanged = vi.fn(() => new Promise<void>(() => undefined));
    render(
      <QuantityPriceBreaksEditor
        itemType="inventory"
        itemId={5}
        practiceId={1}
        item={{ id: 5, name: 'X', price: '9.50', code: null } as api.InventoryItem}
        priceBreaks={[]}
        onChanged={onChanged}
      />
    );
    expect(screen.getByText('No tiers configured.')).toBeTruthy();
    fireEvent.click(screen.getByText('Add price break'));
    const [low, high, price] = screen.getAllByRole('spinbutton');
    fireEvent.change(low, { target: { value: '1' } });
    fireEvent.change(high, { target: { value: '9' } });
    fireEvent.change(price, { target: { value: '9.5' } });
    fireEvent.click(screen.getByText('Create price break'));

    expect(await screen.findByText('Price break created')).toBeTruthy();
    expect(screen.queryByText('No tiers configured.')).toBeNull();
    expect(screen.getByRole('cell', { name: '9' })).toBeTruthy();
    expect(onChanged).toHaveBeenCalledTimes(1);

    // The next break can start straight away, and the new row counts for the overlap check.
    fireEvent.click(screen.getByText('Add price break'));
    const [low2, high2, price2] = screen.getAllByRole('spinbutton');
    fireEvent.change(low2, { target: { value: '5' } });
    fireEvent.change(high2, { target: { value: '999' } });
    fireEvent.change(price2, { target: { value: '8.75' } });
    fireEvent.click(screen.getByText('Create price break'));
    expect(screen.getByText(/overlaps the active price break 1-9/)).toBeTruthy();
  });

  it('takes the reloaded list when the parent passes new breaks', () => {
    const { rerender } = renderEditor([brk(1, 1, 9)]);
    rerender(
      <QuantityPriceBreaksEditor
        itemType="inventory"
        itemId={5}
        practiceId={1}
        item={{ id: 5, name: 'X', price: '14.26', code: null } as api.InventoryItem}
        priceBreaks={[brk(1, 1, 9), brk(2, 10, 999)]}
        onChanged={() => undefined}
      />
    );
    expect(screen.getAllByText('Edit')).toHaveLength(2);
  });

  it('drops a deleted break from the list without waiting for the reload', async () => {
    render(
      <QuantityPriceBreaksEditor
        itemType="inventory"
        itemId={5}
        practiceId={1}
        item={{ id: 5, name: 'X', price: '14.26', code: null } as api.InventoryItem}
        priceBreaks={[brk(1, 1, 9)]}
        onChanged={() => new Promise<void>(() => undefined)}
      />
    );
    fireEvent.click(screen.getByText('Delete'));
    expect(await screen.findByText('No tiers configured.')).toBeTruthy();
  });
});

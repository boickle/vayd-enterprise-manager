/**
 * CAT-09-9: several lots on one invoice line. Add another lot, running total, a wrong total
 * blocks save, one lot looks as before, and a saved multi-lot line loads back into rows.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { vi } from 'vitest';
import MultiLotEditor from './MultiLotEditor';
import { checkLotSplit } from '../../utils/lotSplit';

// The lot dropdown is covered by StockLotPicker.test.tsx; here it is a plain pair of buttons.
vi.mock('./StockLotPicker', () => ({
  default: (p: {
    label?: string;
    selectedLotId: number | null;
    onChange: (n: {
      lotId: number | null;
      lotNumber: string;
      expirationDate: string | null;
    }) => void;
  }) => (
    <div data-testid={`picker-${p.label}`}>
      <span>{p.label}</span>
      <span data-testid={`selected-${p.label}`}>{p.selectedLotId ?? 'none'}</span>
      <button
        type="button"
        onClick={() => p.onChange({ lotId: 1, lotNumber: 'A', expirationDate: null })}
      >
        {`pick A for ${p.label}`}
      </button>
      <button
        type="button"
        onClick={() => p.onChange({ lotId: 2, lotNumber: 'B', expirationDate: null })}
      >
        {`pick B for ${p.label}`}
      </button>
    </div>
  ),
}));

function setup(over: Partial<React.ComponentProps<typeof MultiLotEditor>> = {}) {
  const onSaveLots = vi.fn(async () => true);
  render(
    <MultiLotEditor
      practiceId={1}
      inventoryItemId={9}
      lineQty={20}
      singleLotId={1}
      singleLotNumber="A"
      renderSingle={() => <div>single lot picker</div>}
      onSaveLots={onSaveLots}
      {...over}
    />
  );
  return { onSaveLots };
}

describe('CAT-09-9: several lots on one line', () => {
  it('one lot looks like today: the usual picker and a link to add another', () => {
    setup();
    expect(screen.getByText('single lot picker')).toBeInTheDocument();
    expect(screen.queryByTestId('multi-lot-editor')).toBeNull();
    expect(screen.getByRole('button', { name: '+ Add another lot' })).toBeInTheDocument();
  });

  it('a vaccine (one vial per dose) gets no add-another link', () => {
    setup({ singleOnly: true });
    expect(screen.getByText('single lot picker')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add another lot/i })).toBeNull();
  });

  it('adding a lot shows rows with the first lot at the full quantity and a running total', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: '+ Add another lot' }));
    expect(screen.getByTestId('multi-lot-editor')).toBeInTheDocument();
    expect(screen.getByLabelText('Quantity from lot 1')).toHaveValue(20);
    expect(screen.getByTestId('multi-lot-total')).toHaveTextContent('20 + ? of 20');

    fireEvent.change(screen.getByLabelText('Quantity from lot 1'), { target: { value: '12' } });
    fireEvent.change(screen.getByLabelText('Quantity from lot 2'), { target: { value: '8' } });
    expect(screen.getByTestId('multi-lot-total')).toHaveTextContent('12 + 8 of 20');
  });

  it('saves 12 + 8 as two lots', async () => {
    const { onSaveLots } = setup();
    fireEvent.click(screen.getByRole('button', { name: '+ Add another lot' }));
    fireEvent.change(screen.getByLabelText('Quantity from lot 1'), { target: { value: '12' } });
    fireEvent.click(
      within(screen.getByTestId('picker-Lot 2')).getByRole('button', { name: 'pick B for Lot 2' })
    );
    fireEvent.change(screen.getByLabelText('Quantity from lot 2'), { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save lots' }));
    await waitFor(() =>
      expect(onSaveLots).toHaveBeenCalledWith([
        { inventoryLotBalanceId: 1, lotNumber: 'A', quantity: 12 },
        { inventoryLotBalanceId: 2, lotNumber: 'B', quantity: 8 },
      ])
    );
  });

  it('a total that does not match blocks the save and says why (item needs every unit assigned)', () => {
    const { onSaveLots } = setup({ mustCoverAll: true });
    fireEvent.click(screen.getByRole('button', { name: '+ Add another lot' }));
    fireEvent.change(screen.getByLabelText('Quantity from lot 1'), { target: { value: '12' } });
    fireEvent.click(
      within(screen.getByTestId('picker-Lot 2')).getByRole('button', { name: 'pick B for Lot 2' })
    );
    fireEvent.change(screen.getByLabelText('Quantity from lot 2'), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save lots' }));
    expect(screen.getByRole('alert')).toHaveTextContent('The lots add up to 19 but the line is 20');
    expect(onSaveLots).not.toHaveBeenCalled();
  });

  it('the same lot on two rows blocks the save', () => {
    const { onSaveLots } = setup();
    fireEvent.click(screen.getByRole('button', { name: '+ Add another lot' }));
    fireEvent.change(screen.getByLabelText('Quantity from lot 1'), { target: { value: '12' } });
    fireEvent.click(
      within(screen.getByTestId('picker-Lot 2')).getByRole('button', { name: 'pick A for Lot 2' })
    );
    fireEvent.change(screen.getByLabelText('Quantity from lot 2'), { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save lots' }));
    expect(screen.getByRole('alert')).toHaveTextContent('same lot');
    expect(onSaveLots).not.toHaveBeenCalled();
  });

  it('a normal item may cover part of the quantity but not more', () => {
    expect(checkLotSplit([{ lotId: 1, lotNumber: 'A', quantity: '5' }], 20).ok).toBe(true);
    const over = checkLotSplit([{ lotId: 1, lotNumber: 'A', quantity: '21' }], 20);
    expect(over.ok).toBe(false);
    expect(over.message).toMatch(/more than the 20/);
  });

  it('a saved multi-lot line loads back into rows', () => {
    setup({
      lots: [
        { inventoryLotBalanceId: 1, lotNumber: 'A', quantity: 12 },
        { inventoryLotBalanceId: 2, lotNumber: 'B', quantity: 8 },
      ],
    });
    expect(screen.queryByText('single lot picker')).toBeNull();
    expect(screen.getByLabelText('Quantity from lot 1')).toHaveValue(12);
    expect(screen.getByLabelText('Quantity from lot 2')).toHaveValue(8);
    expect(screen.getByTestId('selected-Lot 1')).toHaveTextContent('1');
    expect(screen.getByTestId('selected-Lot 2')).toHaveTextContent('2');
    expect(screen.getByTestId('multi-lot-total')).toHaveTextContent('12 + 8 of 20');
  });

  it('a read-only line shows its lots but offers no add or save', () => {
    setup({
      disabled: true,
      lots: [
        { inventoryLotBalanceId: 1, lotNumber: 'A', quantity: 12 },
        { inventoryLotBalanceId: 2, lotNumber: 'B', quantity: 8 },
      ],
    });
    expect(screen.queryByRole('button', { name: 'Save lots' })).toBeNull();
    expect(screen.getByLabelText('Quantity from lot 1')).toBeDisabled();
  });
});

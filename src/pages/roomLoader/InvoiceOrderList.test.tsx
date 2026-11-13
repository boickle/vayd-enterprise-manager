import { createEvent, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import InvoiceOrderList, { type InvoiceOrderListRow } from './InvoiceOrderList';
import InvoiceOrderEditor from '../../components/settings/roomLoader/InvoiceOrderEditor';
import { DEFAULT_INVOICE_CATEGORY_ORDER } from '../../utils/roomLoaderInvoiceOrder';

const rows: InvoiceOrderListRow[] = [
  {
    key: 'a:trip',
    name: 'Trip Fee',
    categoryLabel: 'Trip fee',
    source: 'Added',
    qty: 1,
    total: 95,
  },
  {
    key: 'a:exam',
    name: 'Annual Wellness Visit',
    categoryLabel: 'Exam',
    source: 'Added',
    qty: 1,
    total: 85,
  },
  {
    key: 'r:1',
    name: 'DAPP Vaccine',
    categoryLabel: 'Vaccines',
    source: 'Reminder',
    qty: 1,
    total: 42,
  },
];

function renderList(overrides: Partial<Parameters<typeof InvoiceOrderList>[0]> = {}) {
  const onMove = vi.fn();
  const onReset = vi.fn();
  render(
    <InvoiceOrderList
      petName="Bella"
      rows={rows}
      waiting={[]}
      isCustom={false}
      readOnly={false}
      movedKeys={new Set()}
      onMove={onMove}
      onReset={onReset}
      {...overrides}
    />
  );
  return { onMove, onReset };
}

describe('RLO-06 staff Invoice order list', () => {
  it('lists rows in the order given, with the standard badge and no reset button', () => {
    renderList();
    const names = screen
      .getAllByTestId('rl-invoice-order-row')
      .map((r) => r.getAttribute('data-key'));
    expect(names).toEqual(['a:trip', 'a:exam', 'r:1']);
    expect(screen.getByText('Standard order')).toBeTruthy();
    expect(screen.queryByText('Reset to standard order')).toBeNull();
  });

  it('arrows move a row; the first row has no up and the last no down', () => {
    const { onMove } = renderList();
    expect((screen.getByLabelText('Move Trip Fee up') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('Move DAPP Vaccine down') as HTMLButtonElement).disabled).toBe(
      true
    );
    fireEvent.click(screen.getByLabelText('Move DAPP Vaccine up'));
    expect(onMove).toHaveBeenCalledWith('r:1', 1);
    fireEvent.click(screen.getByLabelText('Move Trip Fee down'));
    expect(onMove).toHaveBeenCalledWith('a:trip', 1);
  });

  it('drag and drop moves the dragged row to the drop target', () => {
    const { onMove } = renderList();
    const [trip, , vaccine] = screen.getAllByTestId('rl-invoice-order-row');
    const dataTransfer = { setData: vi.fn(), getData: () => 'r:1', effectAllowed: '' };
    fireEvent.dragStart(vaccine, { dataTransfer });
    const over = createEvent.dragOver(trip, { dataTransfer });
    fireEvent(trip, over);
    expect(over.defaultPrevented).toBe(true);
    fireEvent.drop(trip, { dataTransfer });
    expect(onMove).toHaveBeenCalledWith('r:1', 0);
  });

  it('a drag without a dataTransfer object (synthetic events) still moves the row', () => {
    const { onMove } = renderList();
    const [trip, exam] = screen.getAllByTestId('rl-invoice-order-row');
    fireEvent.dragStart(exam);
    fireEvent.dragOver(trip);
    fireEvent.drop(trip);
    expect(onMove).toHaveBeenCalledWith('a:exam', 0);
  });

  it('custom order shows the badge, Moved tags and a working reset', () => {
    const { onReset } = renderList({ isCustom: true, movedKeys: new Set(['r:1']) });
    expect(screen.getByText('Custom order')).toBeTruthy();
    const vaccineRow = screen.getAllByTestId('rl-invoice-order-row')[2];
    expect(within(vaccineRow).getByText('Moved')).toBeTruthy();
    fireEvent.click(screen.getByText('Reset to standard order'));
    expect(onReset).toHaveBeenCalled();
  });

  it('reminders still needing a match wait at the bottom, not placed', () => {
    renderList({ waiting: [{ key: 'r:9', label: 'Annual fecal (pick a catalog item)' }] });
    const waiting = screen.getByTestId('rl-invoice-order-waiting');
    expect(waiting.textContent).toMatch(/Needs a match.*Annual fecal.*Not placed yet/);
  });

  it('read-only (client already submitted): no arrows, no dragging, no reset', () => {
    renderList({ readOnly: true, isCustom: true });
    expect(screen.queryByLabelText('Move Trip Fee down')).toBeNull();
    expect(screen.getAllByTestId('rl-invoice-order-row')[0].getAttribute('draggable')).toBe(
      'false'
    );
    expect(screen.queryByText('Reset to standard order')).toBeNull();
  });

  it('renders nothing for a pet with no items', () => {
    const { container } = render(
      <InvoiceOrderList
        petName="Max"
        rows={[]}
        waiting={[]}
        isCustom={false}
        readOnly={false}
        movedKeys={new Set()}
        onMove={() => {}}
        onReset={() => {}}
      />
    );
    expect(container.innerHTML).toBe('');
  });
});

describe('RLO-02 Settings → Invoice order editor', () => {
  it('moves a category with the arrows and resets to the default', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <InvoiceOrderEditor categories={[...DEFAULT_INVOICE_CATEGORY_ORDER]} onChange={onChange} />
    );
    expect((screen.getByText('Reset to default order') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('Move Exam up'));
    expect(onChange).toHaveBeenCalledWith([
      'exam',
      'trip',
      'vaccine',
      'lab',
      'procedure',
      'med',
      'store',
    ]);

    rerender(
      <InvoiceOrderEditor
        categories={['exam', 'trip', 'vaccine', 'lab', 'procedure', 'med', 'store']}
        onChange={onChange}
      />
    );
    fireEvent.click(screen.getByText('Reset to default order'));
    expect(onChange).toHaveBeenLastCalledWith([...DEFAULT_INVOICE_CATEGORY_ORDER]);
  });

  it('"Anything else" stays last and cannot be moved', () => {
    render(
      <InvoiceOrderEditor categories={[...DEFAULT_INVOICE_CATEGORY_ORDER]} onChange={() => {}} />
    );
    expect(screen.getByText('Anything else')).toBeTruthy();
    expect(screen.queryByLabelText('Move Anything else up')).toBeNull();
  });
});

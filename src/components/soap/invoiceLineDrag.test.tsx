import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { moveIdBefore, useInvoiceLineDrag, InvoiceSectionOrderReset } from './invoiceLineDrag';

function Harness({ onReorder }: { onReorder: (groupKey: string, ids: string[]) => void }) {
  const drag = useInvoiceLineDrag(onReorder);
  const pets = { 'pet:1': ['trip', 'exam', 'vax'], 'pet:2': ['max-exam'] } as Record<
    string,
    string[]
  >;
  return (
    <div>
      {Object.entries(pets).map(([groupKey, ids]) =>
        ids.map((id) => (
          <div key={id} data-testid={`row-${id}`} {...drag.rowDropProps(groupKey, id, ids)}>
            <span {...drag.gripProps(groupKey, id, id)} data-testid={`grip-${id}`}>
              ::
            </span>
            {id}
          </div>
        ))
      )}
    </div>
  );
}

const dt = () => ({
  setData: vi.fn(),
  getData: vi.fn(),
  setDragImage: vi.fn(),
  effectAllowed: '',
  dropEffect: '',
});

describe('INV-ORD-13 dragging invoice lines (SOAP checkout and direct invoices)', () => {
  it('moveIdBefore puts the dragged line at the drop target', () => {
    expect(moveIdBefore(['a', 'b', 'c'], 'c', 'a')).toEqual(['c', 'a', 'b']);
    expect(moveIdBefore(['a', 'b', 'c'], 'a', 'c')).toEqual(['b', 'c', 'a']);
    const same = ['a', 'b'];
    expect(moveIdBefore(same, 'a', 'a')).toBe(same);
    expect(moveIdBefore(same, 'zz', 'a')).toBe(same);
  });

  it('dropping the vaccine on the trip fee saves the new order for that pet', () => {
    const onReorder = vi.fn();
    render(<Harness onReorder={onReorder} />);
    const transfer = dt();
    fireEvent.dragStart(screen.getByTestId('grip-vax'), { dataTransfer: transfer });
    fireEvent.dragOver(screen.getByTestId('row-trip'), { dataTransfer: transfer });
    fireEvent.drop(screen.getByTestId('row-trip'), { dataTransfer: transfer });
    expect(onReorder).toHaveBeenCalledWith('pet:1', ['vax', 'trip', 'exam']);
  });

  it("a line can't be dropped among another pet's lines", () => {
    const onReorder = vi.fn();
    render(<Harness onReorder={onReorder} />);
    const transfer = dt();
    fireEvent.dragStart(screen.getByTestId('grip-vax'), { dataTransfer: transfer });
    fireEvent.drop(screen.getByTestId('row-max-exam'), { dataTransfer: transfer });
    expect(onReorder).not.toHaveBeenCalled();
  });

  it('the custom-order note offers a reset', () => {
    const onReset = vi.fn();
    render(<InvoiceSectionOrderReset onReset={onReset} />);
    fireEvent.click(screen.getByText('Reset to standard order'));
    expect(onReset).toHaveBeenCalled();
  });
});

/**
 * Owner decisions (Oct 30, 2026): Reprice shows today's price for each line; drops come
 * ticked, raises unticked, hand-priced lines are kept, and it can't go below what's paid.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import RepriceInvoiceModal, { repricedTotal } from './RepriceInvoiceModal';
import type { RepricePreview, RepriceRow } from '../../api/visitWorkflow';

const previewInvoiceReprice = vi.fn();
const applyInvoiceReprice = vi.fn();
vi.mock('../../api/visitWorkflow', () => ({
  previewInvoiceReprice: (...a: unknown[]) => previewInvoiceReprice(...a),
  applyInvoiceReprice: (...a: unknown[]) => applyInvoiceReprice(...a),
}));

const side = (amount: number, covered = false, label?: string) => ({
  unitPrice: amount,
  amount,
  tax: 0,
  covered,
  label: label ?? `$${amount.toFixed(2)}`,
});

const rows: RepriceRow[] = [
  {
    lineId: 'exam',
    description: 'Exam',
    patientId: 5,
    qty: 1,
    current: side(95),
    next: { ...side(0, true, 'covered'), unitPrice: 95, coveredQty: 1, listUnit: 95 },
    change: 'lower',
    reason: 'Covered by Canine Foundations',
    selected: true,
  },
  {
    lineId: 'gaba',
    description: 'Gabapentin',
    patientId: 5,
    qty: 2,
    current: side(32),
    next: { ...side(40), coveredQty: 0, listUnit: 20 },
    change: 'higher',
    reason: 'Regular price',
    selected: false,
  },
  {
    lineId: 'hand',
    description: 'Dental',
    patientId: 5,
    qty: 1,
    current: side(50),
    next: { ...side(50), coveredQty: 0, listUnit: 50 },
    change: 'kept',
    reason: 'Hand-priced — kept',
    selected: false,
  },
];
const preview = (over: Partial<RepricePreview> = {}): RepricePreview => ({
  invoiceId: 'inv-1',
  rows,
  total: 177,
  amountPaid: 0,
  ...over,
});

beforeEach(() => {
  previewInvoiceReprice.mockReset();
  applyInvoiceReprice.mockReset();
});

it('adds up the bill with the ticked rows', () => {
  expect(repricedTotal(preview(), new Set(['exam']))).toBe(82);
  expect(repricedTotal(preview(), new Set(['exam', 'gaba']))).toBe(90);
});

it('ticks the drop, leaves the raise unticked, keeps the hand-priced line, and saves the ticked ones', async () => {
  previewInvoiceReprice.mockResolvedValue(preview());
  applyInvoiceReprice.mockResolvedValue({ id: 'inv-1' });
  const onApplied = vi.fn();
  render(<RepriceInvoiceModal invoiceId="inv-1" onClose={() => undefined} onApplied={onApplied} />);

  expect(await screen.findByText('Covered by Canine Foundations')).toBeInTheDocument();
  const boxes = screen.getAllByRole('checkbox');
  expect(boxes).toHaveLength(2);
  expect(boxes[0]).toBeChecked();
  expect(boxes[1]).not.toBeChecked();
  expect(screen.getByText('Priced by hand — kept')).toBeInTheDocument();
  expect(screen.getByText('$82.00')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Reprice 1 line' }));
  await waitFor(() => expect(applyInvoiceReprice).toHaveBeenCalledWith('inv-1', ['exam']));
  expect(onApplied).toHaveBeenCalledWith({ id: 'inv-1' });
});

it('blocks a reprice that would take the bill below what was paid', async () => {
  previewInvoiceReprice.mockResolvedValue(preview({ amountPaid: 177 }));
  render(<RepriceInvoiceModal invoiceId="inv-1" onClose={() => undefined} onApplied={() => undefined} />);
  expect(await screen.findByText(/below the \$177\.00 already paid/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Reprice 1 line' })).toBeDisabled();
});

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CheckoutInvoiceRxFields, CheckoutPlainLotPicker, closeDrawerAfterApprove } from './VisitCheckoutPanel';

const update = vi.fn();
vi.mock('../../api/visitWorkflow', async (orig) => ({
  ...((await orig()) as object),
  updateCounterInvoiceLine: (...a: unknown[]) => update(...a),
}));
vi.mock('../inventory/StockLotPicker', () => ({
  default: ({ onChange }: { onChange: (p: { lotId: string; lotNumber: string }) => void }) => (
    <button type="button" onClick={() => onChange({ lotId: 'lot-9', lotNumber: 'L9' })}>
      stock-lot-picker
    </button>
  ),
}));
vi.mock('../inventory/MultiLotEditor', () => ({
  default: ({ renderSingle }: { renderSingle: () => unknown }) => <div>{renderSingle() as never}</div>,
  lotEditorProps: () => ({}),
}));
vi.mock('../RoomLoaderPdfCanvas', () => ({ default: () => null }));
vi.mock('../../utils/extractUploadText', () => ({}));
vi.mock('../../utils/householdChartPdfs', () => ({}));
vi.mock('../records/RecordDocumentsReview', () => ({ default: () => null }));
vi.mock('../../permissions/PermissionContext', () => ({
  useCan: () => true,
  usePermissions: () => ({ effective: null }),
}));

describe('checkout lot picker for plain lot-tracked items', () => {
  it('shows one picker and saves the picked lot on the line', async () => {
    const saved = { id: 'inv-1', lines: [] };
    update.mockResolvedValue(saved);
    const onSaved = vi.fn();
    const line = { id: 'l1', description: 'Claro Otic Solution', trackLots: true, inventoryLotBalanceId: null } as never;
    render(
      <CheckoutPlainLotPicker line={line} invoice={{ id: 'inv-1' } as never} disabled={false} onSaved={onSaved} onError={() => {}} />,
    );
    const pickers = screen.getAllByText('stock-lot-picker');
    expect(pickers).toHaveLength(1);
    fireEvent.click(pickers[0]);
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved));
    expect(update).toHaveBeenCalledWith('inv-1', 'l1', { inventoryLotBalanceId: 'lot-9', lotNumber: 'L9' });
  });
});

describe('Rx drawer stays open after Save Rx', () => {
  const rxLine = {
    id: 'rx1',
    description: 'Carprofen',
    instructions: '1 tab PO q12h',
    instructionsEnteredByEmployeeId: 5,
    refillCount: 0,
    writtenAcuity: 'acute',
    catalogDiscardAfter: '2099-01-01',
    trackLots: false,
  } as never;
  const renderRx = (extra: Record<string, unknown>) =>
    render(
      <CheckoutInvoiceRxFields
        line={rxLine}
        invoice={{ id: 'inv-1' } as never}
        recorded={null}
        rxName="Carprofen"
        disabled={false}
        scriptApproved={false}
        mailed={false}
        hideLotPicker
        dymoSource={null}
        patientId={7}
        patientName="Hazel"
        onSaved={() => {}}
        onPrescriptionSaved={() => {}}
        onError={() => {}}
        onApproved={() => {}}
        {...extra}
      />,
    );

  it('Save Rx does not collapse and Approve stays visible', async () => {
    update.mockResolvedValue({ id: 'inv-1' });
    const collapse = vi.fn();
    const onSaved = vi.fn();
    renderRx({ onSavedAndCollapse: collapse, onSaved });
    fireEvent.click(screen.getByRole('button', { name: /Save Rx/ }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(collapse).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeTruthy();
  });

  it('after Approve the drawer closes only when nothing else is needed', () => {
    expect(closeDrawerAfterApprove(null, false)).toBe(true);
    expect(closeDrawerAfterApprove('Pick a lot', true)).toBe(false);
    expect(closeDrawerAfterApprove('Pick a provider', true)).toBe(true);
    expect(closeDrawerAfterApprove('Pick a provider', false)).toBe(false);
  });
});

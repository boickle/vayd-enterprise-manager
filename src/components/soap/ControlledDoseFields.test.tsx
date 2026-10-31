/**
 * Owner decisions (Oct 30, 2026): controlled doses are counted in mL only (no bottle weights),
 * and the mL wasted stays on the invoice line. Same box on the SOAP checkout and the ledger.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import ControlledDoseFields from './ControlledDoseFields';

const recordWaste = vi.fn();
const getInvoice = vi.fn();
vi.mock('../../api/inventoryOps', () => ({ recordWaste: (...a: unknown[]) => recordWaste(...a) }));
vi.mock('../../api/visitWorkflow', () => ({ getInvoice: (...a: unknown[]) => getInvoice(...a) }));
vi.mock('../../permissions/PermissionContext', () => ({ useCan: () => true }));

const invoice = {
  id: 'inv-1',
  status: 'open',
  scoutInvoiceNumber: 1042,
  inventoryBranchId: 3,
  inventoryLocationId: 9,
} as never;
const line = (wasted = 0) =>
  ({
    id: 'line-1',
    description: 'Buprenorphine',
    qty: 0.35,
    catalogItemId: 55,
    trackLots: false,
    lotNumber: 'B-1',
    inventoryLotBalanceId: 7,
    controlledWastedMl: wasted,
  }) as never;

beforeEach(() => {
  recordWaste.mockReset().mockResolvedValue({ id: 1 });
  getInvoice.mockReset();
});

it('shows mL given and wasted, with no bottle weights', () => {
  render(
    <ControlledDoseFields invoice={invoice} line={line(0.1)} practiceId={1} onInvoiceChange={() => undefined} />
  );
  expect(screen.getByText('Controlled drug, used in hospital. Given: 0.35 mL · Wasted: 0.1 mL')).toBeInTheDocument();
  expect(screen.queryByText(/Bottle before/)).toBeNull();
  expect(screen.getByLabelText('Buprenorphine mL wasted')).toBeInTheDocument();
});

it('records waste against the line and reloads the bill so the line shows it', async () => {
  const fresh = { id: 'inv-1' };
  getInvoice.mockResolvedValue(fresh);
  const onInvoiceChange = vi.fn();
  render(<ControlledDoseFields invoice={invoice} line={line()} practiceId={1} onInvoiceChange={onInvoiceChange} />);
  fireEvent.change(screen.getByLabelText('Buprenorphine mL wasted'), { target: { value: '0.1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Record waste' }));
  await waitFor(() => expect(onInvoiceChange).toHaveBeenCalledWith(fresh));
  expect(recordWaste).toHaveBeenCalledWith(
    1,
    expect.objectContaining({
      quantity: 0.1,
      reasonCode: 'drawn_not_given',
      invoiceLineId: 'line-1',
      inventoryLotBalanceId: 7,
    })
  );
});

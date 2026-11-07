/**
 * Wave 8 batch B (owner decisions, Nov 6, 2026): estimates to invoice.
 * - Option A: Convert to invoice on an estimate with no visit asks which visit (today or upcoming);
 *   picking one converts it onto that visit's bill.
 * - Find estimate: from a bill, list the household's open estimates (newest first); each expands to
 *   show pet, lines and total; Convert adds it to this bill.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  getVisitEstimate: vi.fn(),
  createVisitEstimate: vi.fn(),
  convertEstimateToInvoice: vi.fn(),
  fetchEstimateVisitChoices: vi.fn(),
  listClientEstimates: vi.fn(),
}));
vi.mock('../../api/visitEstimates', async (orig) => ({
  ...(await orig<typeof import('../../api/visitEstimates')>()),
  ...api,
}));
vi.mock('./EstimateWorkspace', () => ({ default: () => <div>workspace</div> }));

import EstimateEditorModal from './EstimateEditorModal';
import FindEstimatePanel from './FindEstimatePanel';

const line = (o: Record<string, unknown>) => ({
  id: 'l1', patientId: 3, patientName: 'Juniper', description: 'Dental cleaning', qty: 1,
  unitPrice: 450, amount: 450, isCovered: false, listUnitPrice: null, ...o,
});
const estimate = (o: Record<string, unknown> = {}) => ({
  id: 'e1', practiceId: 1, appointmentId: null, patientId: 3, clientId: 9, estimateNumber: 12,
  title: null, status: 'accepted', total: 450, lines: [line({})], convertedInvoiceId: null,
  expiresAt: null, created: '2026-11-01T15:00:00Z', ...o,
});

afterEach(() => vi.clearAllMocks());

describe('Convert to invoice on an estimate with no visit (option A)', () => {
  it('asks which visit, then converts onto the picked one', async () => {
    api.getVisitEstimate.mockResolvedValue(estimate());
    api.fetchEstimateVisitChoices.mockResolvedValue([
      { appointmentId: 501, start: '2026-11-06T15:00:00Z', patientId: 3, patientName: 'Juniper', providerName: 'Avery Lane', appointmentTypeName: 'Dental' },
      { appointmentId: 502, start: '2026-11-13T15:00:00Z', patientId: 3, patientName: 'Juniper', providerName: 'Priya Shah', appointmentTypeName: 'Recheck' },
    ]);
    api.convertEstimateToInvoice.mockResolvedValue({ id: 'inv-9', total: 450, status: 'open' });
    const onConverted = vi.fn();
    render(<EstimateEditorModal estimateId="e1" clientId={9} pets={[]} onClose={() => {}} onConverted={onConverted} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Convert to invoice' }));
    expect(await screen.findByText(/Which visit is this for\?/)).toBeTruthy();
    expect(api.convertEstimateToInvoice).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('radio', { name: /Recheck/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Convert to this visit' }));
    await waitFor(() => expect(api.convertEstimateToInvoice).toHaveBeenCalledWith('e1', { appointmentId: 502 }));
    expect(onConverted).toHaveBeenCalledWith('inv-9');
  });

  it('says so when the family has no visit today or coming up', async () => {
    api.getVisitEstimate.mockResolvedValue(estimate());
    api.fetchEstimateVisitChoices.mockResolvedValue([]);
    render(<EstimateEditorModal estimateId="e1" clientId={9} pets={[]} onClose={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Convert to invoice' }));
    expect(await screen.findByText(/No visit today or coming up/)).toBeTruthy();
  });

  it('an estimate already on a visit converts straight away', async () => {
    api.getVisitEstimate.mockResolvedValue(estimate({ appointmentId: 501 }));
    api.convertEstimateToInvoice.mockResolvedValue({ id: 'inv-9', total: 450, status: 'open' });
    render(<EstimateEditorModal estimateId="e1" clientId={9} pets={[]} onClose={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Convert to invoice' }));
    await waitFor(() => expect(api.convertEstimateToInvoice).toHaveBeenCalledWith('e1', undefined));
    expect(api.fetchEstimateVisitChoices).not.toHaveBeenCalled();
  });
});

describe('Find estimate on a bill', () => {
  it('lists open estimates newest first; one expands to show pet, lines and total; Convert adds it here', async () => {
    api.listClientEstimates.mockResolvedValue([
      estimate({ id: 'e2', estimateNumber: 14, total: 120, created: '2026-11-05T15:00:00Z',
        lines: [line({ id: 'l2', description: 'Nail trim', amount: 25, patientName: 'Maple', unitPrice: 25 }),
                line({ id: 'l3', description: 'Ear cytology', amount: 95, patientName: 'Maple', unitPrice: 95 })] }),
      estimate(),
    ]);
    api.convertEstimateToInvoice.mockResolvedValue({ id: 'inv-1', total: 570, status: 'open' });
    const onConverted = vi.fn();
    render(<FindEstimatePanel clientId={9} invoiceId="inv-1" onConverted={onConverted} />);
    fireEvent.click(screen.getByRole('button', { name: 'Find estimate' }));
    await waitFor(() => expect(api.listClientEstimates).toHaveBeenCalledWith(9, { billable: true }));
    const rows = await screen.findAllByTestId('find-estimate-row');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText(/Estimate #14/)).toBeTruthy();
    expect(within(rows[0]).getByText('$120.00')).toBeTruthy();
    expect(screen.queryByText('Ear cytology')).toBeNull();
    fireEvent.click(within(rows[0]).getByRole('button', { name: /Estimate #14/ }));
    expect(within(rows[0]).getByText('Ear cytology')).toBeTruthy();
    expect(within(rows[0]).getAllByText(/Maple/).length).toBeGreaterThan(0);
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Convert' }));
    await waitFor(() => expect(api.convertEstimateToInvoice).toHaveBeenCalledWith('e2', { invoiceId: 'inv-1' }));
    expect(onConverted).toHaveBeenCalledWith('inv-1');
  });

  it('Convert is one click: the button is disabled while it runs', async () => {
    api.listClientEstimates.mockResolvedValue([estimate()]);
    let finish: (v: unknown) => void = () => {};
    api.convertEstimateToInvoice.mockReturnValue(new Promise((r) => (finish = r)));
    render(<FindEstimatePanel clientId={9} invoiceId="inv-1" onConverted={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Find estimate' }));
    const [row] = await screen.findAllByTestId('find-estimate-row');
    fireEvent.click(within(row).getByRole('button', { name: /Estimate #12/ }));
    const btn = within(row).getByRole('button', { name: 'Convert' });
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(api.convertEstimateToInvoice).toHaveBeenCalledTimes(1);
    finish({ id: 'inv-1', total: 450, status: 'open' });
  });

  it('says so when the family has no open estimates', async () => {
    api.listClientEstimates.mockResolvedValue([]);
    render(<FindEstimatePanel clientId={9} invoiceId="inv-1" onConverted={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Find estimate' }));
    expect(await screen.findByText(/No open estimates for this family/)).toBeTruthy();
  });
});

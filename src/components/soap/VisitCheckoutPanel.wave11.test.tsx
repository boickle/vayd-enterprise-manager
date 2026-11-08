import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getInvoiceCardOnFile = vi.fn();
const fetchAvailableAccountCredit = vi.fn();
const chargeSavedCard = vi.fn();

vi.mock('../../api/visitWorkflow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/visitWorkflow')>()),
  getInvoiceCardOnFile: (...a: unknown[]) => getInvoiceCardOnFile(...a),
  fetchAvailableAccountCredit: (...a: unknown[]) => fetchAvailableAccountCredit(...a),
  chargeSavedCard: (...a: unknown[]) => chargeSavedCard(...a),
}));
vi.mock('./TerminalReaderPicker', () => ({ default: () => null }));
vi.mock('../../auth/useAuth', () => ({ useAuth: () => ({ user: {}, employeeId: 1 }) }));
vi.mock('./CheckoutReminders', () => ({ default: () => null }));
vi.mock('../RoomLoaderPdfCanvas', () => ({ default: () => null }));
vi.mock('../../utils/extractUploadText', () => ({}));
vi.mock('../../utils/householdChartPdfs', () => ({}));
vi.mock('../records/RecordDocumentsReview', () => ({ default: () => null }));
vi.mock('../../permissions/PermissionContext', () => ({
  useCan: () => true,
  usePermissions: () => ({ effective: {}, can: () => true }),
}));

import VisitCheckoutPanel from './VisitCheckoutPanel';

const baseInvoice = {
  id: 'inv-1',
  patientId: 7,
  clientId: 5,
  status: 'finalized',
  lines: [],
  subtotal: 162,
  total: 162,
  amountPaid: 0,
  tenders: [],
  inventoryBranchId: 1,
  inventoryLocationId: 1,
};
const tender = (o: Record<string, unknown>) => ({
  invoiceId: 'inv-1',
  cashierEmployeeId: 1,
  receivedAt: '2026-11-07T10:00:00Z',
  ...o,
});
const renderPanel = (invoice: Record<string, unknown>, onInvoiceChange = vi.fn()) =>
  render(
    <VisitCheckoutPanel
      {...({
        invoice,
        patientId: 7,
        roster: [{ patientId: 7, patientName: 'Hazel' }],
        practiceId: 1,
        onInvoiceChange,
      } as never)}
    />,
  );

describe('Wave 11 checkout payment area', () => {
  beforeEach(() => {
    getInvoiceCardOnFile.mockReset();
    getInvoiceCardOnFile.mockResolvedValue({ card: null, declinedAt: null });
    fetchAvailableAccountCredit.mockReset();
    fetchAvailableAccountCredit.mockResolvedValue({ total: 0, scout: 0, evet: 0 });
    chargeSavedCard.mockReset();
  });

  it('shows Balance due after a partial payment and updates when the invoice changes', async () => {
    const view = renderPanel({
      ...baseInvoice,
      amountPaid: 50,
      tenders: [tender({ id: 't1', method: 'gift_card', amount: 50 })],
    });
    const row = await screen.findByTestId('checkout-balance-due');
    expect(row.textContent).toContain('Balance due');
    expect(row.textContent).toContain('$112.00');
    view.rerender(
      <VisitCheckoutPanel
        {...({
          invoice: { ...baseInvoice, amountPaid: 80 },
          patientId: 7,
          roster: [{ patientId: 7, patientName: 'Hazel' }],
          practiceId: 1,
          onInvoiceChange: vi.fn(),
        } as never)}
      />,
    );
    expect((await screen.findByTestId('checkout-balance-due')).textContent).toContain('$82.00');
  });

  it('has no Balance due row before anything is paid', async () => {
    renderPanel(baseInvoice);
    await screen.findByRole('button', { name: /Tap to Pay/ });
    expect(screen.queryByTestId('checkout-balance-due')).toBeNull();
  });

  it('Account credit shows the credit and is highlighted when there is credit', async () => {
    fetchAvailableAccountCredit.mockResolvedValue({ total: 30, scout: 30, evet: 0 });
    renderPanel(baseInvoice);
    const btn = await screen.findByRole('button', { name: 'Account credit ($30.00)' });
    expect(btn.className).toContain('is-highlight');
  });

  it('Account credit stays plain with no credit', async () => {
    renderPanel(baseInvoice);
    const btn = await screen.findByRole('button', { name: 'Account credit' });
    await waitFor(() => expect(fetchAvailableAccountCredit).toHaveBeenCalledWith(5));
    expect(btn.className).not.toContain('is-highlight');
  });

  it('Card on file names the card and is highlighted; the charge is confirmed with the amount', async () => {
    getInvoiceCardOnFile.mockResolvedValue({
      card: { customerId: 'c', paymentMethodId: 'pm', last4: '4242', brand: 'visa', expMonth: 1, expYear: 2030 },
      declinedAt: null,
    });
    chargeSavedCard.mockResolvedValue({ ...baseInvoice, status: 'paid', amountPaid: 162 });
    renderPanel({ ...baseInvoice, total: 162, amountPaid: 80 });
    const btn = await screen.findByRole('button', { name: 'Card on file · Visa •4242' });
    expect(btn.className).toContain('is-highlight');
    await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(btn);
    expect(chargeSavedCard).not.toHaveBeenCalled();
    const confirm = await screen.findByRole('button', { name: 'Charge $82.00 to Visa •4242' });
    fireEvent.click(confirm);
    await waitFor(() => expect(chargeSavedCard).toHaveBeenCalledWith('inv-1'));
  });

  it('Card on file stays plain and disabled with no card', async () => {
    renderPanel(baseInvoice);
    const btn = (await screen.findByRole('button', { name: 'Card on file' })) as HTMLButtonElement;
    await waitFor(() => expect(getInvoiceCardOnFile).toHaveBeenCalled());
    expect(btn.disabled).toBe(true);
    expect(btn.className).not.toContain('is-highlight');
  });

  it('says Paid in full and lists each tender', async () => {
    renderPanel({
      ...baseInvoice,
      status: 'paid',
      amountPaid: 162,
      tenders: [
        tender({ id: 't1', method: 'gift_card', amount: 50, cardLast4: '9PVM' }),
        tender({ id: 't2', method: 'account_credit', amount: 30 }),
        tender({ id: 't3', method: 'card', amount: 82, cardBrand: 'visa', cardLast4: '4242' }),
        tender({ id: 't4', method: 'cash', amount: 10, voidedAt: '2026-11-07T11:00:00Z' }),
      ],
    });
    const box = await screen.findByTestId('checkout-paid-in-full');
    expect(within(box).getByText('Paid in full')).toBeTruthy();
    const items = within(box).getAllByRole('listitem').map((li) => li.textContent);
    expect(items).toEqual([
      'Gift card ••••9PVM $50.00',
      'Account credit $30.00',
      'Visa •4242 $82.00',
    ]);
    expect(screen.queryByTestId('checkout-balance-due')).toBeNull();
  });
});

describe('line layout keeps qty and amount in separate columns', () => {
  const css = readFileSync(resolve(__dirname, '../../pages/SoapEncounterPage.css'), 'utf8');
  it('uses one wide amount column for header, rows and ship rows', () => {
    const grids = css.match(/grid-template-columns: 22px minmax\(0, 1fr\) 7\.25rem [^;]+;/g) ?? [];
    expect(grids.length).toBeGreaterThanOrEqual(4);
    for (const g of grids) {
      expect(g).toContain('var(--soap-line-qty-col, 3.5rem) var(--soap-line-amt-col, 10.5rem)');
    }
    expect(css).not.toMatch(/7\.25rem 2\.75rem 5\.75rem/);
  });
  it('amount cell wraps instead of spilling over the qty box', () => {
    const block = css.match(/\.soap-invoice-line-amt \{[^}]*flex-wrap[^}]*\}/)?.[0] ?? '';
    expect(block).toContain('flex-wrap: wrap');
    expect(block).toContain('min-width: 0');
  });
});

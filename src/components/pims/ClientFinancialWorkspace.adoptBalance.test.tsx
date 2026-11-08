/**
 * W12-3: "Edit in Scout" on an old eVet invoice with a balance. The page holds the client record it
 * loaded with, whose balance already includes that invoice; the new Scout copy must not be added
 * on top of it until a reload.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../permissions/PermissionContext', () => ({
  useCan: () => true,
  useScope: () => 'all',
  usePermissions: () => ({ can: () => true, effective: null }),
}));
vi.mock('../../permissions/useCanOrAdminLogin', () => ({ useCanOrAdminLogin: () => true }));

const listClientVisitInvoices = vi.fn();
const adoptEvetInvoice = vi.fn();
const getInvoice = vi.fn();
vi.mock('../../api/visitWorkflow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/visitWorkflow')>()),
  listClientVisitInvoices: (...a: unknown[]) => listClientVisitInvoices(...a),
  adoptEvetInvoice: (...a: unknown[]) => adoptEvetInvoice(...a),
  getInvoice: (...a: unknown[]) => getInvoice(...a),
  listClientEstimates: async () => [],
}));
vi.mock('../../api/clientsStaff', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/clientsStaff')>()),
  fetchClientBillingStaff: async () => ({}),
}));
vi.mock('../../auth/AuthProvider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../auth/AuthProvider')>()),
  useAuth: () => ({ user: {}, employeeId: 1, role: 'practice_manager' }),
}));
vi.mock('./ClientCardOnFileSection', () => ({ default: () => null }));

import ClientFinancialWorkspace from './ClientFinancialWorkspace';
import { evetBalanceWithoutAdopted } from '../../utils/clientFinancial';

const evetInvoice = (id: number, number: string, due: number) =>
  ({
    key: `evet-${id}`,
    number,
    date: 'Mar 3, 2025',
    status: 'closed',
    createdBy: '',
    total: due,
    paid: 0,
    due,
    listSubtotal: due,
    discountSavings: 0,
    lines: [],
    removedLines: [],
    raw: { id, invoiceNumber: number, isDeleted: false },
  }) as never;

// Owner's video: eVet #48213 owes $80 (the record's eVet balance), Scout #524 owes $75: $155 in all.
const invoices = [evetInvoice(48213, '48213', 80)];
const scout524 = {
  id: 'scout-524', practiceId: 1, clientId: 5, evetInvoiceId: null, status: 'finalized',
  total: 75, amountPaid: 0, subtotal: 75, taxTotal: 0, lines: [], tenders: [], isDeleted: false,
  invoiceNumber: 524,
} as never;

const adopted = {
  id: 'scout-1',
  practiceId: 1,
  clientId: 5,
  evetInvoiceId: 48213,
  evetInvoiceNumber: '48213',
  status: 'finalized',
  total: 80,
  amountPaid: 0,
  subtotal: 80,
  taxTotal: 0,
  lines: [],
  tenders: [],
  isDeleted: false,
} as never;

describe('W12-3 balance after Edit in Scout', () => {
  beforeEach(() => {
    listClientVisitInvoices.mockReset().mockResolvedValue([scout524]);
    getInvoice.mockReset().mockResolvedValue(adopted);
    adoptEvetInvoice.mockReset().mockResolvedValue(adopted);
  });

  it('the helper takes a taken-over invoice out of the eVet balance once', () => {
    const set = new Set([48213]);
    expect(evetBalanceWithoutAdopted(80, invoices as never, set)).toBe(0);
    expect(evetBalanceWithoutAdopted(80, invoices as never, new Set())).toBe(80);
    // A refreshed record no longer lists the invoice: nothing more comes off.
    expect(evetBalanceWithoutAdopted(0, [], set)).toBe(0);
  });

  it('Balance due stays $155.00 right after Edit in Scout, with no reload', async () => {
    render(
      <MemoryRouter>
        <ClientFinancialWorkspace
          clientId={5}
          clientName="Pat Client"
          evetBalance={80}
          evetInvoices={invoices}
          pets={[]}
          cashierEmployeeId={1}
        />
      </MemoryRouter>,
    );
    await screen.findByText('Balance due');
    await waitFor(() => expect(document.querySelector('.client-fin__bal-value')?.textContent).toBe('$155.00'));

    // After the take-over, the ledger lists the Scout copy.
    listClientVisitInvoices.mockResolvedValue([scout524, adopted]);
    fireEvent.click(await screen.findByText('#48213'));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit in Scout' }));
    await waitFor(() => expect(adoptEvetInvoice).toHaveBeenCalledWith(48213));
    await waitFor(() => expect(listClientVisitInvoices).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Edit in Scout' })).toBeNull());
    expect(screen.queryByText('$235.00')).toBeNull();
    // The edit pane reads like a normal edit; "not saved yet" waits for a removed line.
    expect(screen.getAllByText('Scout owns this bill now. Edit it, then save.').length).toBeGreaterThan(0);
    expect(screen.queryByText(/Removed lines are not saved yet/)).toBeNull();
    expect(document.querySelector('.client-fin__bal-value')?.textContent).toBe('$155.00');
    // The pay-link line agrees with the balance, and the eVet row is gone from the ledger.
    expect(screen.getAllByText(/Sends \$155\.00 for 2 unpaid invoices/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('#48213')).toHaveLength(1); // the Scout copy only
  });
});

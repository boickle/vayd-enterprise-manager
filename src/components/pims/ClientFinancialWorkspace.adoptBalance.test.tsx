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

// #48213 owes $80 and another old invoice owes $75: the record's balance is $155.
const invoices = [evetInvoice(48213, '48213', 80), evetInvoice(40100, '40100', 75)];

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
    listClientVisitInvoices.mockReset().mockResolvedValue([]);
    getInvoice.mockReset().mockResolvedValue(adopted);
    adoptEvetInvoice.mockReset().mockResolvedValue(adopted);
  });

  it('the helper takes a taken-over invoice out of the eVet balance once', () => {
    const set = new Set([48213]);
    expect(evetBalanceWithoutAdopted(155, invoices as never, set)).toBe(75);
    expect(evetBalanceWithoutAdopted(155, invoices as never, new Set())).toBe(155);
    // A refreshed record no longer lists the invoice: nothing more comes off.
    expect(evetBalanceWithoutAdopted(75, [invoices[1]] as never, set)).toBe(75);
  });

  it('Balance due stays $155.00 right after Edit in Scout, with no reload', async () => {
    render(
      <MemoryRouter>
        <ClientFinancialWorkspace
          clientId={5}
          clientName="Pat Client"
          evetBalance={155}
          evetInvoices={invoices}
          pets={[]}
          cashierEmployeeId={1}
        />
      </MemoryRouter>,
    );
    await screen.findByText('Balance due');
    expect(screen.getByText('$155.00')).toBeTruthy();

    // After the take-over, the ledger lists the Scout copy.
    listClientVisitInvoices.mockResolvedValue([adopted]);
    fireEvent.click(await screen.findByText('#48213'));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit in Scout' }));
    await waitFor(() => expect(adoptEvetInvoice).toHaveBeenCalledWith(48213));
    await waitFor(() => expect(listClientVisitInvoices).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Edit in Scout' })).toBeNull());
    expect(screen.queryByText('$235.00')).toBeNull();
    expect(screen.getAllByText('$155.00').length).toBeGreaterThan(0);
  });
});

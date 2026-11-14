/**
 * PAY-C5 on the Financial tab (owner, Nov 13, 2026): an expired card on file is shown but never
 * charged, the same as checkout. "Charge card on file" is not offered for it.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../permissions/PermissionContext', () => ({
  useCan: () => true,
  useScope: () => 'all',
  usePermissions: () => ({ can: () => true, effective: null }),
}));
vi.mock('../../permissions/useCanOrAdminLogin', () => ({ useCanOrAdminLogin: () => true }));

const getInvoiceCardOnFile = vi.fn();
vi.mock('../../api/visitWorkflow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/visitWorkflow')>()),
  listClientVisitInvoices: async () => [bill],
  getInvoice: async () => bill,
  listClientEstimates: async () => [],
  getInvoiceCardOnFile: (...a: unknown[]) => getInvoiceCardOnFile(...a),
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

const bill = {
  id: 'scout-517', practiceId: 1, clientId: 5, evetInvoiceId: null, status: 'open',
  total: 75, amountPaid: 0, subtotal: 75, taxTotal: 0,
  lines: [{ id: 'l1', description: 'Office exam', qty: 1, unitPrice: 75, amount: 75, patientId: 9 }], tenders: [], isDeleted: false,
  invoiceNumber: 517, created: '2026-11-13T22:00:00.000Z', updated: '2026-11-13T22:00:00.000Z', invoiceDate: '2026-11-13',
} as never;

const card = (expired: boolean) => ({
  card: {
    customerId: 'cus_1', paymentMethodId: 'pm_1', brand: 'visa', last4: '4242',
    expMonth: 10, expYear: 2026, expired,
  },
  declinedAt: null,
});

function open() {
  render(
    <MemoryRouter>
      <ClientFinancialWorkspace clientId={5} clientName="Tom Chen" evetBalance={0} evetInvoices={[]} pets={[]} cashierEmployeeId={1} />
    </MemoryRouter>,
  );
  // The open bill opens on its own.
}

describe('Financial tab: expired card on file', () => {
  beforeEach(() => getInvoiceCardOnFile.mockReset());

  it('says the card expired and does not offer Charge card on file', async () => {
    getInvoiceCardOnFile.mockResolvedValue(card(true));
    open();
    await screen.findByText('Expired, ending 4242');
    expect(screen.getByText(/Ask the owner for a new card/)).toBeTruthy();
    const option = screen.getByRole('option', { name: /Card on file · Expired, ending 4242/ }) as HTMLOptionElement;
    expect(option.disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Charge card on file' })).toBeNull();
    expect(screen.queryByText(/Charges Visa/)).toBeNull();
  });

  it('a good card is still the default, with Charge card on file', async () => {
    getInvoiceCardOnFile.mockResolvedValue(card(false));
    open();
    const btn = (await screen.findByRole('button', { name: 'Charge card on file' })) as HTMLButtonElement;
    await waitFor(() => expect(btn.disabled).toBe(false));
    expect(screen.getByText(/Charges Visa •••• 4242 · exp 10\/26/)).toBeTruthy();
  });
});

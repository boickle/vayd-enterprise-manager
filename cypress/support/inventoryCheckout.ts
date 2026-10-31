import { api, inventoryWorld } from './inventoryWorld';

/** A lot added through the API (the same call the "Add lot" form makes). */
export function addLot(
  itemId: number,
  office: { branchId: number; mainLocationId: number },
  lotNumber: string,
  expirationDate: string,
  quantityOnHand: number
) {
  const w = inventoryWorld();
  return api<{ id: number }>(
    'inventoryManager',
    'POST',
    `/practice/${w.practiceId}/inventory-lots`,
    {
      inventoryItemId: itemId,
      branchId: office.branchId,
      branchLocationId: office.mainLocationId,
      lotNumber,
      expirationDate,
      quantityOnHand,
    }
  );
}

/**
 * The seeded pet's counter invoice, drawing from `office`'s Main shelf, with one $0 charge
 * (so "Close invoice" closes it without taking a payment). Yields the invoice id.
 */
export function counterInvoiceWith(
  office: { branchId: number; mainLocationId: number },
  line: {
    catalogItemId: number;
    description: string;
    qty: number;
    inventoryLotBalanceId?: number | null;
  }
) {
  const w = inventoryWorld();
  return api<{ id: string }>('technician', 'POST', '/visit-invoices/counter', {
    practiceId: w.practiceId,
    patientId: w.patientId,
    clientId: w.clientId,
  }).then((inv) => {
    api('technician', 'PATCH', `/visit-invoices/${inv.id}`, {
      practiceId: w.practiceId,
      inventoryBranchId: office.branchId,
      inventoryLocationId: office.mainLocationId,
    });
    api('technician', 'POST', `/visit-invoices/${inv.id}/lines`, {
      practiceId: w.practiceId,
      patientId: w.patientId,
      unitPrice: 0,
      catalogItemType: 'inventory',
      providerEmployeeId: w.employees.technician,
      ...line,
    });
    return cy.wrap(inv.id);
  });
}

export const financialTab = (invoiceId: string) =>
  `/schedule/clients?clientId=${inventoryWorld().clientId}&tab=financial&invoice=${invoiceId}`;

/** Opens a charge's row (lot, dose and Rx details) on the Financial tab. */
export function openCharge(description: string) {
  cy.contains('button.client-fin__item-toggle', description, { timeout: 30000 }).click();
}

/** Pays what's left on the open invoice in cash (no card, no Stripe), which closes it. */
export function payCash() {
  cy.contains('option', 'Cash').parent('select').select('Cash');
  cy.get('input[placeholder]')
    .filter((_, el) => /^\d+\.\d{2}$/.test((el as HTMLInputElement).placeholder))
    .first()
    .then(($amount) => {
      const due = ($amount[0] as HTMLInputElement).placeholder;
      cy.wrap($amount).clear().type(due);
    });
  cy.contains('button', 'Record Cash').click();
}

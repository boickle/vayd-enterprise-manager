/// <reference types="cypress" />
import '../support/e2e';
import { api, eventually, inventoryWorld, signInAs } from '../support/inventoryWorld';
import {
  counterInvoiceWith,
  financialTab,
  openCharge,
  payCash,
} from '../support/inventoryCheckout';

/**
 * INV-07-2: a vaccine that needs a lot #, on an uncounted shelf with no lots (owner decision D4).
 * At checkout the picker offers "Add lot"; staff add the lot # and expiration from the vial,
 * record the dose and close. The lot is created at this shelf, the dose comes off it, and the
 * vaccination record shows it.
 */
describe("INV-07-2: add the vial's lot at checkout on an uncounted shelf", () => {
  it('creates the lot at the shelf, draws the dose from it and records it', () => {
    const w = inventoryWorld();
    const office = w.uncounted;
    const lotNumber = `${w.tag}-VIAL`;

    counterInvoiceWith(office, {
      catalogItemId: w.items.vaccineId,
      description: 'Rabies vaccine',
      qty: 1,
    }).then((invoiceId) => {
      signInAs('technician', financialTab(invoiceId));
      openCharge('Rabies vaccine');

      cy.get('.soap-dose-lot-picker', { timeout: 20000 }).within(() =>
        cy.contains('button', 'Add lot').click()
      );
      cy.get('[aria-label="Add lot"]').within(() => {
        cy.contains('label', 'Lot number').find('input').type(lotNumber);
        cy.get('input[placeholder="MM/DD/YYYY"]').type('09/30/2028').blur();
        cy.contains('button', /^Add lot$/).click();
      });
      cy.get('[aria-label="Add lot"]').should('not.exist');

      cy.contains('label', 'Next due').find('input').type('2029-10-28');
      cy.contains('label', 'Rabies tag').find('input').type('0');
      cy.contains('button', 'Record dose').click();
      cy.contains('button', 'Update dose', { timeout: 20000 });

      payCash();

      const lots = () =>
        api<Array<{ lotNumber: string; branchLocationId: number; quantityOnHand: number }>>(
          'inventoryManager',
          'GET',
          `/practice/${w.practiceId}/inventory-items/${w.items.vaccineId}/lots?branchId=${office.branchId}&includeZero=true`
        ).then((rows) => rows.find((l) => l.lotNumber === lotNumber));
      // Added with 1 (the vial in hand), then the dose is drawn from it.
      eventually(lots, (lot) => Number(lot?.quantityOnHand) === 0).then((lot) => {
        expect(lot?.branchLocationId).to.eq(office.mainLocationId);
        expect(Number(lot?.quantityOnHand)).to.eq(0);
      });
      api<{ status: string }>(
        'technician',
        'GET',
        `/visit-invoices/${invoiceId}?practiceId=${w.practiceId}`
      )
        .its('status')
        .should('eq', 'paid');
      api<Array<{ lotNumber: string | null }>>(
        'technician',
        'GET',
        `/visit-invoices/${invoiceId}/vaccinations?practiceId=${w.practiceId}`
      ).then((doses) => {
        expect(doses.map((d) => d.lotNumber)).to.include(lotNumber);
      });
    });
  });
});

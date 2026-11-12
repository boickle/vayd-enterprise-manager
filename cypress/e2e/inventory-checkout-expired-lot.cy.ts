/// <reference types="cypress" />
import '../support/e2e';
import { api, eventually, inventoryWorld, signInAs } from '../support/inventoryWorld';
import {
  addLot,
  counterInvoiceWith,
  financialTab,
  openCharge,
  payCash,
} from '../support/inventoryCheckout';

/**
 * INV-04-9: at checkout a vaccine's expired lot is shown but can't be picked (owner decision D2,
 * blocked at pick); the invoice closes on the current lot and the dose comes off that lot.
 */
describe('INV-04-9: checkout skips the expired vaccine lot', () => {
  it("can't pick the expired lot and closes on the current one", () => {
    const w = inventoryWorld();
    const office = w.counted;
    const lotsOf = () =>
      api<Array<{ id: number; lotNumber: string; quantityOnHand: number }>>(
        'inventoryManager',
        'GET',
        `/practice/${w.practiceId}/inventory-items/${w.items.vaccineId}/lots?branchId=${office.branchId}&includeZero=true`
      );

    addLot(w.items.vaccineId, office, `${w.tag}-OLD`, '2026-10-01', 5);
    addLot(w.items.vaccineId, office, `${w.tag}-NEW`, '2029-06-30', 5);
    counterInvoiceWith(office, {
      catalogItemId: w.items.vaccineId,
      description: 'Rabies vaccine',
      qty: 1,
    }).then((invoiceId) => {
      signInAs('technician', financialTab(invoiceId));
      openCharge('Rabies vaccine');
      cy.contains('option', `Lot ${w.tag}-OLD`, { timeout: 20000 })
        .should('be.disabled')
        .and('contain.text', 'Expired Oct 1')
        .parent()
        .parent('select')
        .as('lotSelect');
      cy.contains('option', `Lot ${w.tag}-NEW`)
        .should('not.be.disabled')
        .invoke('val')
        .then((value) => cy.get('@lotSelect').select(String(value)));
      cy.contains('Dose / lot needed').should('not.exist');
      payCash();
      api<{ status: string }>(
        'technician',
        'GET',
        `/visit-invoices/${invoiceId}?practiceId=${w.practiceId}`
      )
        .its('status')
        .should('be.oneOf', ['paid', 'finalized']);

      const qty = (lots: Array<{ lotNumber: string; quantityOnHand: number }>, n: string) =>
        Number(lots.find((l) => l.lotNumber === n)?.quantityOnHand);
      eventually(lotsOf, (lots) => qty(lots, `${w.tag}-NEW`) === 4).then((lots) => {
        const byNumber = Object.fromEntries(
          lots.map((l) => [l.lotNumber, Number(l.quantityOnHand)])
        );
        expect(byNumber[`${w.tag}-NEW`]).to.eq(4);
        expect(byNumber[`${w.tag}-OLD`]).to.eq(5);
      });
    });
  });
});

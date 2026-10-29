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
 * INV-08-11: a controlled liquid set to "weight" (10 mL bottles, 1.2 g/mL, empty bottle 5.5 g).
 * Staff enter its first count by bottle weight on First Counts (17.5 g = 10 mL), then charge a
 * 0.35 mL dose at checkout. On-hand and the lot end at 9.65 mL.
 */
describe('INV-08-11: controlled liquid by weight, then a dose at checkout', () => {
  it('counts 10 mL from the bottle weight and draws exactly 0.35 mL from that lot', () => {
    const w = inventoryWorld();
    const office = w.uncounted;
    const item = `${w.tag} controlled liquid (weight)`;
    const lotNumber = `${w.tag}-CW`;
    const lotQty = () =>
      api<Array<{ lotNumber: string; branchLocationId: number; quantityOnHand: number }>>(
        'inventoryManager',
        'GET',
        `/practice/${w.practiceId}/inventory-items/${w.items.controlledWeightId}/lots?branchId=${office.branchId}&includeZero=true`
      ).then((rows) => Number(rows.find((l) => l.lotNumber === lotNumber)?.quantityOnHand));
    const shelf = () =>
      api<{ locations: Array<{ branchLocationId: number; quantityOnHand: number }> }>(
        'inventoryManager',
        'GET',
        `/practice/${w.practiceId}/branches/${office.branchId}/inventory-items/${w.items.controlledWeightId}/stock`
      ).then((s) =>
        Number(
          s.locations.find((l) => l.branchLocationId === office.mainLocationId)?.quantityOnHand
        )
      );

    // First count by weight.
    signInAs('inventoryManager', '/schedule/inventory/first-counts');
    cy.contains('option', 'Choose office', { timeout: 30000 })
      .parent('select')
      .select(`${w.tag} uncounted office`);
    // Changing the office reloads its locations and clears the pick; choose after it settles.
    cy.wait(1500);
    cy.contains('option', 'Choose location')
      .parent('select')
      .as('location')
      .find('option')
      .contains(/^Main\b/)
      .invoke('val')
      .then((value) => {
        cy.get('@location').select(String(value));
        cy.get('@location').should('have.value', String(value));
      });
    cy.get(`input[aria-label="${item} weight in g"]`, { timeout: 20000 }).type('17.5');
    cy.get(`input[aria-label="${item} lot number"]`).type(lotNumber);
    cy.get(`input[aria-label="${item} expiration"]`).type('1/2028');
    cy.intercept('POST', '**/first-count').as('firstCount');
    cy.contains('button', /Review 1 typed count/).click();
    cy.wait('@firstCount', { timeout: 30000 });
    cy.contains(/= 10 mL/, { timeout: 20000 });
    cy.contains('button', 'Save 1 first count').click();
    cy.contains(/Saved first counts for 1 item/, { timeout: 20000 });
    lotQty().should('eq', 10);
    shelf().should('eq', 10);

    // A 0.35 mL dose at checkout, from that lot.
    counterInvoiceWith(office, {
      catalogItemId: w.items.controlledWeightId,
      description: 'Controlled liquid',
      qty: 0.35,
    }).then((invoiceId) => {
      signInAs('technician', financialTab(invoiceId));
      openCharge('Controlled liquid');
      cy.contains('option', `Lot ${lotNumber}`, { timeout: 20000 })
        .parent('select')
        .find(':selected')
        .should('contain.text', `Lot ${lotNumber}`);
      payCash();
      eventually(lotQty, (q) => Math.abs(q - 9.65) < 1e-6).should('be.closeTo', 9.65, 1e-6);
      shelf().should('be.closeTo', 9.65, 1e-6);
    });
  });
});

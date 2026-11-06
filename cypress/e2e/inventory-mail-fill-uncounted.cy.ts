/// <reference types="cypress" />
import '../support/e2e';
import { api, eventually, inventoryWorld, signInAs } from '../support/inventoryWorld';

/**
 * INV-07-3: a mail order fills from a shelf that hasn't had its first count (owner decision D4):
 * "Existing stock" is offered, the order is marked filled and the stock comes off. No "receive
 * stock first" dead end.
 */
describe('INV-07-3: mail-order fill from an uncounted shelf', () => {
  it('fills from existing stock and draws the shelf', () => {
    const w = inventoryWorld();
    const office = w.uncounted;
    const shelf = () =>
      api<{ locations: Array<{ branchLocationId: number; quantityOnHand: number }> }>(
        'inventoryManager',
        'GET',
        `/practice/${w.practiceId}/branches/${office.branchId}/inventory-items/${w.items.stockId}/stock`
      ).then((s) =>
        Number(
          s.locations.find((l) => l.branchLocationId === office.mainLocationId)?.quantityOnHand ?? 0
        )
      );

    signInAs('technician', `/schedule/mail-orders?orderId=${w.mailOrderId}`);
    cy.contains('option', 'Choose office…', { timeout: 30000 })
      .parent('select')
      .select(`${w.tag} uncounted office`);
    // The office change reloads the location list (and clears the pick); choose after it settles.
    cy.wait(1500);
    cy.contains('option', 'Choose location…')
      .parent('select')
      .as('location')
      .find('option')
      .contains(/^Main\b/)
      .invoke('val')
      .then((value) => {
        cy.get('@location').select(String(value));
        cy.get('@location').should('have.value', String(value));
      });
    cy.contains('option', 'Existing stock — shelf not counted yet', { timeout: 20000 })
      .parent('select')
      .select('Existing stock — shelf not counted yet');
    cy.contains('button', 'Mark filled').should('not.be.disabled').click();

    eventually(
      () =>
        api<{ processStatus: string }>(
          'technician',
          'GET',
          `/practice/${w.practiceId}/mail-orders/${w.mailOrderId}`
        ),
      (o) => o.processStatus !== 'queued'
    )
      .its('processStatus')
      .should('not.eq', 'queued');
    shelf().should('eq', -180);
  });
});

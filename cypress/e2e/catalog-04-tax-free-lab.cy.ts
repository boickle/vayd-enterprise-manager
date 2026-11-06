/// <reference types="cypress" />
import '../support/e2e';
import { catalogWorld, signInAsCatalog } from '../support/catalogWorld';
import { addCharge, plainClient, sql, startInvoice } from '../support/catalogUi';

/**
 * CAT-04-6: a manager creates a lab without touching the tax setting (it defaults to None, per D2);
 * the doctor adds it to an invoice and the line carries $0 tax.
 */
describe('CAT-04-6: a new lab is tax-free from the Catalog screen to the invoice', () => {
  it('creates the lab with tax None and charges no tax', () => {
    const w = catalogWorld();
    const labName = `${w.tag} new lab ${Date.now()}`;

    signInAsCatalog('practice_manager', '/schedule/inventory/items');
    cy.contains('button', 'Add item', { timeout: 30000 }).click();
    cy.get('[role="radiogroup"][aria-label="New item type"]').contains('button', 'Lab').click();
    cy.contains('label', /^Name/).find('input').type(labName);
    cy.contains('label', /^Price/).find('input').type('50');
    cy.contains('label', /Tax/).find('select').find('option:selected').should('have.text', 'None');
    cy.contains('button', 'Next').click();
    cy.wait(3000);
    sql(`SELECT \"taxLevelValue\" FROM labs WHERE name = '${labName}'`).then((v) => expect(v).to.eq('0'));

    plainClient('cat0406').then((who) => {
      signInAsCatalog('veterinarian', `/schedule/clients?clientId=${who.clientId}&tab=financial`);
      startInvoice();
      addCharge(who.petName, labName);
      cy.contains('Subtotal', { timeout: 15000 }).parent().should('contain.text', '$50.00');
      cy.contains('Tax').parent().should('contain.text', '$0.00');
    });
  });
});

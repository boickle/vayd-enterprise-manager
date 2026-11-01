/// <reference types="cypress" />
import '../support/e2e';
import { catalogWorld, signInAsCatalog } from '../support/catalogWorld';
import { sql } from '../support/catalogUi';

/**
 * CAT-03-10: with the role checks on the write routes, a practice manager can still add a price break,
 * a tagalong and a reminder rule from the Catalog screen: all three save and no error shows.
 */
describe('CAT-03-10: the Catalog screen still saves breaks, tagalongs and reminders', () => {
  it('saves all three with no error message', () => {
    const w = catalogWorld();
    const id = w.items.feeMinimumId;
    const reminderText = `${w.tag} reminder ${Date.now()}`;
    sql(`DELETE FROM quantity_price_breaks WHERE "inventoryItemId" = ${id}`);
    sql(`DELETE FROM catalog_tagalongs WHERE "triggerItemId" = ${id}`);

    signInAsCatalog('practice_manager', '/schedule/inventory/items');
    cy.get('input[placeholder^="Search products"]', { timeout: 30000 }).type(`${w.tag} fee and minimum`);
    cy.contains('td', `${w.tag} fee and minimum`, { timeout: 20000 }).click();

    // Price break
    cy.contains('button', 'Pricing', { timeout: 15000 }).click();
    cy.contains('button', 'Add price break').click();
    cy.contains('label', 'Low quantity').parent().find('input').type('5');
    cy.contains('label', 'High quantity').parent().find('input').type('9');
    cy.contains('label', /^Price$/).parent().find('input').type('1.25');
    cy.contains('button', 'Create price break').click();
    cy.contains('Create price break').should('not.exist');
    cy.get('.settings-error-message').should('not.exist');
    sql(`SELECT count(*) FROM quantity_price_breaks WHERE "inventoryItemId" = ${id} AND "lowQuantity" = 5 AND "highQuantity" = 9 AND "isActive"`).then((n) => expect(n).to.eq('1'));

    // Tagalong
    cy.contains('button', 'Associations').click();
    cy.get('input[placeholder^="Search rebate SKU"]').type(`${w.tag} stock draw`);
    cy.contains('button.inv-stock-link__result', `${w.tag} stock draw`, { timeout: 15000 }).click();
    cy.contains('button', 'Add tagalong').click();
    cy.contains('button', 'Add tagalong').should('be.disabled');
    cy.get('.settings-error-message').should('not.exist');
    sql(`SELECT count(*) FROM catalog_tagalongs WHERE "triggerItemId" = ${id} AND "isActive"`).then((n) => expect(Number(n)).to.be.at.least(1));

    // Reminder rule
    cy.contains('button', 'Add reminder').click();
    cy.contains('label', 'Description').find('input').type(reminderText);
    cy.contains('button', 'Save reminder').click();
    cy.contains('button', 'Save reminder').should('not.exist');
    cy.contains(reminderText, { timeout: 15000 });
    cy.get('.settings-error-message').should('not.exist');
    sql(`SELECT count(*) FROM catalog_item_reminders r JOIN catalog_reminder_definitions d ON d.id = r."definitionId" WHERE r."inventoryItemId" = ${id} AND d.description = '${reminderText}'`).then((n) => expect(n).to.eq('1'));
  });
});

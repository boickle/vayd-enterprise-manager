/// <reference types="cypress" />
import '../support/e2e';
import { catalogWorld, signInAsCatalog } from '../support/catalogWorld';
import { addCharge, emailInvoiceText, plainClient, sql, startInvoice, stubGmail } from '../support/catalogUi';

/**
 * CAT-06-10: a manager raises a taxable item from $40 to $44 in Catalog; the doctor adds it at
 * checkout; the line is $44.00 with $2.42 tax and the emailed invoice shows the same total.
 */
describe('CAT-06-10: catalog price change reaches the invoice and the email', () => {
  it('line $44.00, tax $2.42, emailed total matches', () => {
    const w = catalogWorld();
    const gmail = stubGmail();
    const name = `${w.tag} cost-plus item`;
    sql(`UPDATE inventory_items SET price = 40 WHERE id = ${w.items.costPlusId}`);

    signInAsCatalog('practice_manager', '/schedule/inventory/items');
    cy.get('input[placeholder^="Search products"]', { timeout: 30000 }).type(`${w.tag} cost-plus`);
    cy.contains('td', name, { timeout: 20000 }).click();
    cy.contains('label', /^Price/, { timeout: 15000 }).find('input').clear().type('44');
    cy.contains('button', 'Save catalog fields').click();
    cy.wait(3000);
    sql(`SELECT price FROM inventory_items WHERE id = ${w.items.costPlusId}`).then((v) => expect(Number(v)).to.eq(44));

    plainClient('cat0610').then((who) => {
      signInAsCatalog('veterinarian', `/schedule/clients?clientId=${who.clientId}&tab=financial`);
      startInvoice();
      addCharge(who.petName, name);
      cy.contains('Subtotal', { timeout: 15000 }).parent().should('contain.text', '$44.00');
      cy.contains('Tax').parent().should('contain.text', '$2.42');
      emailInvoiceText(gmail).then((text) => {
        expect(text).to.contain('$44.00');
        expect(text).to.contain('$2.42');
        expect(text).to.contain('$46.42');
      });
    });
  });
});

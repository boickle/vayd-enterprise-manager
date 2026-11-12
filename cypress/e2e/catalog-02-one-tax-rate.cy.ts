/// <reference types="cypress" />
import '../support/e2e';
import { catalogApi, catalogWorld, signInAsCatalog } from '../support/catalogWorld';
import { addCharge, ensureLocations, plainClient, startInvoice } from '../support/catalogUi';

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * CAT-02-9: an admin saves 5.5 on Settings, Sales tax; the doctor checks out a taxable item; the invoice
 * tax is 5.5% and the day's sales tax report moves by exactly that sale.
 */
describe('CAT-02-9: Settings sales tax to invoice to sales tax report', () => {
  it('invoice tax is 5.5% and the report matches the invoice', () => {
    const w = catalogWorld();
    const report = () =>
      catalogApi<any>('admin', 'GET', `/analytics/sales-tax?start=${today()}&end=${today()}&practiceId=${w.practiceId}`);
    ensureLocations();

    signInAsCatalog('admin', '/schedule/settings?tab=inventory-sales-tax');
    cy.contains('label', 'Level 1 rate (%)', { timeout: 30000 }).find('input').as('rate');
    cy.get('@rate').should('have.value', '5.5');
    cy.get('@rate').clear().type('5.5');
    cy.contains('button', 'Save sales tax').click();
    cy.wait(2500);
    catalogApi<any>('admin', 'GET', `/practice/${w.practiceId}/tax-settings`).then((t) => {
      expect(Number(t.taxLevel1Rate)).to.eq(5.5);
    });

    report().then((before) => {
      expect(before.taxRate).to.be.closeTo(0.055, 1e-9);
      plainClient('cat0209').then((who) => {
        signInAsCatalog('veterinarian', `/schedule/clients?clientId=${who.clientId}&tab=financial`);
        startInvoice();
        addCharge(who.petName, `${w.tag} cost-plus item`);
        cy.contains('Subtotal', { timeout: 15000 }).parent().should('contain.text', '$40.00');
        cy.contains('Tax').parent().should('contain.text', '$2.20');
        cy.contains('button', 'Record Cash', { timeout: 15000 }).should('not.be.disabled').click();
        cy.contains(/Recorded Cash \$42\.20|Paid/, { timeout: 20000 });
        cy.wait(1500);
        report().then((after) => {
          const d = (k: string) => Math.round((after.summary[k] - before.summary[k]) * 100) / 100;
          expect(d('taxableSales'), 'taxable sales').to.eq(40);
          expect(d('salesTax'), 'sales tax').to.eq(2.2);
          expect(d('totalWithTax'), 'total with tax').to.eq(42.2);
          expect(after.summary.invoices - before.summary.invoices).to.eq(1);
        });
      });
    });

    signInAsCatalog('admin', '/schedule/analytics/sales-tax');
    cy.contains('Sales tax at 5.5%', { timeout: 30000 });
  });
});

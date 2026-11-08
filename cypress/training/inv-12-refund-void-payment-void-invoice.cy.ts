/// <reference types="cypress" />
/**
 * Training video, INV-12: refund, void a payment, or void an invoice
 * (docs/training/scripts/invoicing/INV-12-refund-void-payment-void-invoice.md). TEST stack on Stripe TEST mode, demo names
 * only: Maria Rivera and Maple, signed in as the manager. The bill is an Office exam of $75: $20 cash (recorded on the
 * wrong bill) and $55 on the card on file (a Stripe test Visa). Needs invoicing-demo.sql.
 */
import '../support/e2e';
import { schedulingApi, schedulingWorld, signInAsScheduling } from '../support/schedulingWorld';
import { counterBill, giveSavedCard, resetInvoicingWorld, setBillBranch, sql } from './invKit';
import { finish, line, loadNarration, offCamera, pointAt, startClock, tap, typeSlowly } from './trainingKit';

describe('Training: INV-12 refund, void payment, void invoice', () => {
  it('INV-12', () => {
    const w = schedulingWorld();
    const client = w.households.A.clientId;
    const [maple] = w.households.A.activePetIds;
    const pid = w.practiceId;
    loadNarration();
    resetInvoicingWorld();
    giveSavedCard(client, `maria.rivera.inv12.${Date.now()}@example.com`, 'Maria Rivera');

    let inv = '';
    let invNo = '';
    counterBill(maple, client, ['Office exam']).then((id) => (inv = id));
    cy.then(() => setBillBranch(client));
    cy.then(() => schedulingApi('manager', 'POST', `/visit-invoices/${inv}/tenders`, { practiceId: pid, method: 'cash', paymentTypeName: 'Cash', amount: 20, cashReceived: 20, changeGiven: 0 }));
    cy.then(() => schedulingApi('cl', 'POST', `/visit-payments/${inv}/charge-saved-card`, { practiceId: pid }));
    cy.then(() => sql(`SELECT "scoutInvoiceNumber" || '|' || status || '|' || total FROM visit_invoices WHERE id='${inv}'`).then((r) => {
      invNo = String(r).split('|')[0];
      expect(String(r), 'bill is paid').to.contain('|paid|75');
    }));
    cy.then(() => signInAsScheduling('manager', `/schedule/clients?clientId=${client}&tab=financial`));
    cy.contains('tr.is-click', '#', { timeout: 60000 }).should('exist');
    cy.then(() => cy.contains('tr.is-click', `#${invNo}`).click());
    cy.contains('button', /^Refund$/, { timeout: 30000 }).should('exist');
    cy.wait(1500);

    const dialogButton = (re: RegExp) => cy.contains('.app-dialog button', re);
    startClock();
    line('inv12-01');
    line('inv12-02', () => pointAt(() => cy.contains('.client-fin__pay-cat', 'Payments'), 3000));
    line('inv12-03');
    line('inv12-04', () => {
      tap(() => cy.contains('button', /^Refund$/));
      cy.contains('Refund payment', { timeout: 30000 }).should('exist');
    });
    line('inv12-05', () => pointAt(() => cy.contains('Refunds the client\'s card via Stripe'), 3500));
    line('inv12-06', () => pointAt(() => cy.contains('Amount (partial or full)'), 4000));
    line('inv12-07', () => {
      tap(() => cy.contains('button', /^Cancel$/).filter(':visible').last());
      cy.contains('Refund payment').should('not.exist');
    });
    line('inv12-08', () => {
      tap(() => cy.contains('button', /^Void$/));
      cy.contains('Reason for voiding this payment?', { timeout: 30000 }).should('exist');
    });
    line('inv12-09', () => pointAt(() => cy.contains('Reason for voiding this payment?'), 4500));
    line('inv12-10', () => {
      tap(() => dialogButton(/^Cancel$/));
      cy.contains('Reason for voiding this payment?').should('not.exist');
      cy.get('.app-dialog').should('not.exist');
      cy.wait(600, { log: false });
    });
    line('inv12-11', () => {
      tap(() => cy.contains('button', 'Void invoice'));
      cy.contains('Void invoice?', { timeout: 30000 }).should('be.visible');
      cy.get('.app-dialog textarea, .app-dialog input').first().should('be.visible');
    });
    line('inv12-12', () => typeSlowly(() => cy.get('.app-dialog textarea, .app-dialog input').first(), 'Training: voiding the bill'));
    line('inv12-13', () => tap(() => dialogButton(/^Void$/)));
    offCamera(() => cy.contains('Refund the card payment first', { timeout: 30000 }).should('exist'));
    line('inv12-14', () => pointAt(() => cy.contains('Refund the card payment first'), 5000));
    line('inv12-15');
    line('inv12-16');
    finish();
  });
});

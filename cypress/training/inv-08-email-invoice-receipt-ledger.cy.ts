/// <reference types="cypress" />
/**
 * Training video, INV-08: email an invoice, receipt or household ledger
 * (docs/training/scripts/invoicing/INV-08-email-invoice-receipt-ledger.md). TEST stack, demo names only: Maria Rivera
 * and Maple. The test stack has no Gmail, so the shared Info inbox and the send are stubbed in the browser (nothing
 * is emailed). Needs invoicing-demo.sql.
 */
import '../support/e2e';
import { schedulingWorld, signInAsScheduling } from '../support/schedulingWorld';
import { counterBill, resetInvoicingWorld, sql } from './invKit';
import { finish, line, loadNarration, pointAt, startClock, tap } from './trainingKit';

describe('Training: INV-08 email invoice, receipt, ledger', () => {
  it('INV-08', () => {
    const w = schedulingWorld();
    const client = w.households.A.clientId;
        const [maple] = w.households.A.activePetIds;
    loadNarration();
    resetInvoicingWorld();
    cy.intercept('GET', '**/gmail/mailboxes*', {
      mailboxes: [{ email: 'info@vetatyourdoor.com', kind: 'shared', displayLabel: 'Info', connected: true, authMode: 'service_account' }],
      defaultMailbox: 'info@vetatyourdoor.com',
    });
    cy.intercept('GET', '**/gmail/access*', { allowed: true });
    cy.intercept('GET', '**/gmail/send-as*', { aliases: [] });
    cy.intercept('POST', '**/gmail/messages/send*', { id: 'training-stub', threadId: 'training-stub' }).as('send');

    // The paid bill is the demo's $25 nail trim (paid by card, seeded by invoicing-demo.sql); the open one is made here.
    let open = '';
    let paidNo = '';
    let openNo = '';
    sql(`SELECT "scoutInvoiceNumber" FROM visit_invoices WHERE "clientId"=${client} AND "isDeleted"=false AND status='paid' ORDER BY "scoutInvoiceNumber" DESC LIMIT 1`).then((n) => (paidNo = String(n).trim()));
    counterBill(maple, client, ['Nail trim']).then((id) => (open = id));
    cy.then(() => sql(`SELECT "scoutInvoiceNumber" FROM visit_invoices WHERE id='${open}'`).then((n) => (openNo = String(n).trim())));
    cy.then(() => signInAsScheduling('cl', `/schedule/clients?clientId=${client}&tab=financial`));
    cy.contains('button', 'Email Ledger', { timeout: 60000 }).should('exist');
    cy.contains('tr.is-click', '#', { timeout: 60000 }).should('exist');
    cy.wait(1500);

    startClock();
    line('inv08-01');
    line('inv08-02', () => {
      cy.then(() => tap(() => cy.contains('tr.is-click', `#${paidNo}`)));
      cy.contains('button', 'Email receipt', { timeout: 30000 }).should('exist');
    });
    line('inv08-03');
    line('inv08-04', () => pointAt(() => cy.contains('button', 'Email receipt'), 3500));
    line('inv08-05', () => {
      tap(() => cy.contains('button', 'Email receipt'));
      cy.contains('Review and edit the email', { timeout: 30000 }).should('exist');
    });
    line('inv08-06', () => pointAt(() => cy.contains('Review and edit the email'), 3000));
    line('inv08-07', () => {
      tap(() => cy.contains('[role="dialog"] button, .modal button', 'Send email'));
      cy.contains('Review and edit the email').should('not.exist');
    });
    line('inv08-08', () => {
      cy.then(() => tap(() => cy.contains('tr.is-click', `#${openNo}`)));
      cy.contains('button', 'Email invoice', { timeout: 30000 }).should('exist');
    });
    line('inv08-09', () => pointAt(() => cy.contains('button', 'Email invoice'), 3500));
    line('inv08-10', () => pointAt(() => cy.contains('button', 'Email Ledger'), 4000));
    line('inv08-11', () => pointAt(() => cy.contains('button', 'Print'), 3000));
    line('inv08-12');
    finish();
  });
});

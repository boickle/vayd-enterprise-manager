/// <reference types="cypress" />
/**
 * Training video, INV-06: make and send an estimate
 * (docs/training/scripts/invoicing/INV-06-make-and-send-an-estimate.md). TEST stack, demo names only: Maria Rivera and
 * Juniper (no plan, so the estimate prices match the bill: estimates still ignore the member discount, an app bug).
 * The test stack has no Gmail, so the shared Info inbox and the send are stubbed in the browser: the window is the
 * real one, and nothing is emailed. Needs invoicing-demo.sql.
 */
import '../support/e2e';
import { schedulingWorld, signInAsScheduling } from '../support/schedulingWorld';
import { resetInvoicingWorld, sql } from './invKit';
import { choose, finish, line, loadNarration, pointAt, startClock, tap, typeSlowly } from './trainingKit';

describe('Training: INV-06 make and send an estimate', () => {
  it('INV-06', () => {
    const w = schedulingWorld();
    const client = w.households.A.clientId;
    loadNarration();
    resetInvoicingWorld();
    sql(`UPDATE visit_estimates SET "isDeleted"=true WHERE "clientId"=${client}`);
    // Stub the shared inbox (the stack has no Gmail) and the send; nothing leaves the machine.
    cy.intercept('GET', '**/gmail/mailboxes*', {
      mailboxes: [{ email: 'info@vetatyourdoor.com', kind: 'shared', displayLabel: 'Info', connected: true, authMode: 'service_account' }],
      defaultMailbox: 'info@vetatyourdoor.com',
    });
    cy.intercept('GET', '**/gmail/access*', { allowed: true });
    cy.intercept('GET', '**/gmail/send-as*', { aliases: [] });
    cy.intercept('POST', '**/gmail/messages/send*', { id: 'training-stub', threadId: 'training-stub' }).as('send');

    signInAsScheduling('cl', `/schedule/clients?clientId=${client}&tab=financial`);
    cy.contains('button', 'New estimate', { timeout: 60000 }).should('exist');
    cy.wait(1500);

    startClock();
    line('inv06-01');
    line('inv06-02', () => pointAt(() => cy.contains('No estimates yet'), 4500));
    line('inv06-03');
    line('inv06-04', () => {
      tap(() => cy.contains('button', 'New estimate'));
      cy.contains('Lines save as you add them', { timeout: 30000 }).should('be.visible');
    });
    line('inv06-05', () => pointAt(() => cy.contains('Lines save as you add them'), 4000));
    line('inv06-06', () => choose(() => cy.get('.estimate-charge-to select'), 'Juniper'));
    line('inv06-07', () => typeSlowly(() => cy.get('.estimate-search input'), 'Dental cleaning'));
    line('inv06-08', () => {
      tap(() => cy.contains('.estimate-hits button', 'Dental cleaning'));
      cy.contains('.estimate-lines', 'Dental cleaning', { timeout: 30000 }).should('exist');
    });
    line('inv06-09', () => typeSlowly(() => cy.get('.estimate-search input'), 'Dental X-rays'));
    line('inv06-10', () => {
      tap(() => cy.contains('.estimate-hits button', 'Dental X-rays'));
      cy.contains('.estimate-lines', 'Dental X-rays', { timeout: 30000 }).should('exist');
    });
    line('inv06-11', () => pointAt(() => cy.get('.estimate-total-row.is-grand'), 4000));
    line('inv06-12', () => {
      tap(() => cy.contains('button', 'Email estimate'));
      cy.contains('Review and edit the email', { timeout: 30000 }).should('exist');
    });
    line('inv06-13', () => pointAt(() => cy.contains('Review and edit the email'), 4500));
    line('inv06-14', () => {
      tap(() => cy.contains('[role="dialog"] button, .modal button', 'Send email'));
    });
    line('inv06-15', () => {
      tap(() => cy.contains('.euth-estimate-actions button', 'Save estimate'));
      cy.get('.euth-estimate-modal').should('not.exist');
    });
    line('inv06-16', () => pointAt(() => cy.contains('tr.is-click', 'Estimate #'), 5500));
    line('inv06-17');
    finish();
  });
});

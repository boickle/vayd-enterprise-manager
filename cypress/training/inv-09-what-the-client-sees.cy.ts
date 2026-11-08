/// <reference types="cypress" />
/**
 * Training video, INV-09: what the client sees in the portal
 * (docs/training/scripts/invoicing/INV-09-what-the-client-sees.md). TEST stack, demo names only: Maria Rivera signed in
 * to the client portal (her login email matches her record) with one open bill for Juniper. Nothing is paid.
 * Needs invoicing-demo.sql.
 */
import '../support/e2e';
import { schedulingWorld, signInAsScheduling } from '../support/schedulingWorld';
import { counterBill, resetInvoicingWorld } from './invKit';
import { finish, line, loadNarration, offCamera, pointAt, startClock, tap } from './trainingKit';

describe('Training: INV-09 what the client sees', () => {
  it('INV-09', () => {
    const w = schedulingWorld();
    const client = w.households.A.clientId;
    const [, juniper] = w.households.A.activePetIds;
    loadNarration();
    resetInvoicingWorld();
    counterBill(juniper, client, ['Nail trim']);
    cy.then(() => signInAsScheduling('client', '/client-portal'));
    cy.contains('Your balance', { timeout: 60000 }).should('exist');
    cy.wait(1500);

    startClock();
    line('inv09-01');
    line('inv09-02', () => pointAt(() => cy.contains('.pp-account__row', 'Your balance'), 3500));
    line('inv09-03', () => pointAt(() => cy.contains('.pp-account__row', 'prompt payment'), 3000));
    line('inv09-04', () => {
      tap(() => cy.contains('.pp-account__row button', 'Pay now'));
      cy.contains('button', 'View open invoice', { timeout: 30000 }).should('exist');
    });
    line('inv09-05', () => {
      tap(() => cy.contains('button', 'View open invoice'));
      cy.contains('Open invoices', { timeout: 30000 }).should('exist');
    });
    line('inv09-06', () => pointAt(() => cy.contains('Open invoices').closest('[role="dialog"], .pp-modal'), 4500));
    line('inv09-07', () => {
      tap(() => cy.contains('button', 'Done'));
      cy.contains('Open invoices').should('not.exist');
    });
    offCamera(() => cy.get('.pp-account__pay', { timeout: 60000 }).should(($e) => expect($e.text()).to.match(/Card on file/)));
    line('inv09-08', () => pointAt(() => cy.contains('Have a gift card?'), 3500));
    line('inv09-09', () => pointAt(() => cy.contains('.pp-account__card-on-file', 'Card on file'), 3500));
    line('inv09-09b', () => {
      tap(() => cy.contains('button', 'Use a different card'));
      cy.get('.vayd-store__card-entry').should('exist');
    });
    line('inv09-09c', () => pointAt(() => cy.get('.vayd-store__card-entry'), 4500));
    line('inv09-10', () => pointAt(() => cy.contains('.pp-account__pay button', /^Pay \$/), 3000));
    line('inv09-12');
    finish();
  });
});

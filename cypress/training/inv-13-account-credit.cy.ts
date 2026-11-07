/// <reference types="cypress" />
/**
 * Training video, INV-13: account credit, where it comes from and how it is used
 * (docs/training/scripts/invoicing/INV-13-account-credit.md). TEST stack, demo names only: Maria Rivera and Juniper,
 * signed in as the manager (Robin Hale). Juniper's visit has one Office exam at $75 and Maria starts with no credit.
 */
import '../support/e2e';
import { schedulingApi, schedulingWorld, signInAsScheduling } from '../support/schedulingWorld';
import { catalogId, clearAccountCredit, openVisit, resetInvoicingWorld, setBillBranch } from './invKit';
import { finish, line, loadNarration, offCamera, pointAt, startClock, tap, typeSlowly } from './trainingKit';

describe('Training: INV-13 account credit', () => {
  it('INV-13', () => {
    const w = schedulingWorld();
    const client = w.households.A.clientId;
    const juniper = w.households.A.activePetIds[1];
    const pid = w.practiceId;
    loadNarration();
    resetInvoicingWorld();
    clearAccountCredit(client);

    let appt = 0;
    let invoiceId = '';
    openVisit(juniper, client, 'Office exam', 90).then(({ appt: a, enc }) => {
      appt = a;
      schedulingApi<{ id: string }>('cl', 'POST', '/visit-invoices', { practiceId: pid, appointmentId: a, clientId: client }).then((inv) => {
        invoiceId = inv.body.id;
        setBillBranch(client);
        catalogId('Office exam').then((c) =>
          schedulingApi('doctorA', 'POST', `/soap-encounters/${enc}/orders`, {
            practiceId: pid, name: 'Office exam', catalogItemId: c.id, catalogItemType: c.type, qty: 1, kind: 'treatment', state: 'accepted', unitPrice: 75,
          })
        );
      });
    });
    cy.then(() => signInAsScheduling('manager', `/schedule/clients?clientId=${client}&tab=financial&invoice=${invoiceId}`));
    cy.contains('button', 'Add credit', { timeout: 60000 }).should('exist');
    cy.contains('Sends $75.00', { timeout: 60000 }).should('exist');
    cy.wait(1500);

    const dialogBtn = (re: RegExp) => cy.contains('.app-dialog button', re);
    startClock();
    line('inv13-01');
    line('inv13-02', () => pointAt(() => cy.contains(/balance due/i).parent(), 3500));
    line('inv13-03');
    line('inv13-04', () => {
      tap(() => cy.contains('button', 'Add credit'));
      cy.contains('.app-dialog', 'Adds credit to this client', { timeout: 30000 }).should('exist');
    });
    line('inv13-05', () => pointAt(() => cy.contains('.app-dialog', 'Adds credit to this client'), 3500));
    line('inv13-06', () => typeSlowly(() => cy.get('#app-dialog-credit-amount'), '30'));
    line('inv13-07', () => typeSlowly(() => cy.get('#app-dialog-credit-reason'), 'Goodwill for the late arrival'));
    line('inv13-08', () => tap(() => dialogBtn(/^Add credit$/)));
    offCamera(() => cy.contains('Added $30.00 account credit', { timeout: 30000 }).should('exist'));
    line('inv13-09', () => pointAt(() => cy.contains('Credit').filter('td, span, div').filter(':visible').first(), 3500));
    line('inv13-10', () => pointAt(() => cy.contains('account credit comes off first'), 5000));
    line('inv13-11', () => {
      tap(() => cy.contains('button', 'Add credit'));
      cy.contains('.app-dialog', 'Adds credit to this client', { timeout: 30000 }).should('exist');
    });
    line('inv13-12', () => typeSlowly(() => cy.get('#app-dialog-credit-amount'), '50'));
    line('inv13-13', () => typeSlowly(() => cy.get('#app-dialog-credit-reason'), 'Prepaid for the next visit'));
    line('inv13-14', () => tap(() => dialogBtn(/^Add credit$/)));
    offCamera(() => cy.contains('Their account credit covers this balance', { timeout: 30000 }).should('exist'));
    line('inv13-15', () => pointAt(() => cy.contains('Their account credit covers this balance'), 5000));
    // Checkout page for the same bill.
    offCamera(() => {
      cy.then(() => cy.visit(`/schedule/soap/${appt}/${juniper}/checkout?clientId=${client}`));
      cy.contains('.soap-invoice-row.total', '$75.00', { timeout: 60000 }).should('exist');
      cy.contains('.soap-checkout-actions button', 'Account credit', { timeout: 60000 }).should('not.be.disabled');
      cy.wait(1500);
    });
    line('inv13-16', () => tap(() => cy.contains('.soap-checkout-actions button', 'Account credit')));
    line('inv13-17', () => pointAt(() => cy.contains('.account-credit-tender', 'available'), 4500));
    line('inv13-18', () => tap(() => cy.contains('.account-credit-tender button', 'Apply credit')));
    line('inv13-19', () => pointAt(() => cy.contains(/Used \$75\.00 of account credit/), 4500));
    line('inv13-20');
    line('inv13-21');
    finish();
  });
});

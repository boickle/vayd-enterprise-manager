/// <reference types="cypress" />
/**
 * Training video OSV-04: paying a balance in the portal, including an old eVet bill. TEST stack, Stripe TEST mode.
 * Shows the app after go-live: the stack runs with EVET_SYNC_ENABLED=false (eVet sync off), so eVet bills are payable
 * online. Tom Chen has an $85 open eVet bill (setup/online-store-demo.cjs); an earlier take's portal payment on it is
 * taken off first. He pays with Stripe's test Visa.
 */
import '../support/e2e';
import { enterTestCard, look, osv, resetStoreData, signIn, sql } from './osvTraining';
import { finish, line, loadNarration, offCamera, pointAt, startClock, tap } from './trainingKit';

describe('Training: OSV-04 paying a balance in the portal', () => {
  it('OSV-04', () => {
    const o = osv();
    loadNarration();
    resetStoreData();
    // Tom's eVet bill open again: remove an earlier take's portal payment on it.
    sql(
      `DELETE FROM invoice_payments WHERE "pimsType"='SCOUT_PORTAL' AND "invoiceId" IN (SELECT id FROM invoices WHERE "clientId"=${o.clients.chen} AND "pimsType"='EVET');` +
        ` DELETE FROM payments WHERE "pimsType"='SCOUT_PORTAL' AND "clientId"=${o.clients.chen};` +
        ` UPDATE invoices SET "amountPaid"=0, "invoiceStatusValue"=1 WHERE "clientId"=${o.clients.chen} AND "pimsType"='EVET' AND "invoiceNumber"=48213`
    );
    signIn('chen', '/client-portal');
    cy.contains('.pp-greeting-name', 'Tom', { timeout: 40000 });
    cy.contains('section.pp-account', 'Your balance: $85.00', { timeout: 30000 });
    cy.get('.vayd-store__evet-held').should('not.exist');
    cy.wait(1500);
    startClock();

    line('b01-why');
    line('b02-tom', () => pointAt(() => cy.get('.pp-greeting')));
    line('b03-balance', () => pointAt(() => cy.contains('section.pp-account', 'Your balance'), 3500));
    line('b09-paynow', () => tap(() => cy.contains('section.pp-account button', /^Pay now$/)));
    line('b10-card', () => enterTestCard('4242424242424242', 'Tom Chen'));
    line('b11-pay', () => tap(() => cy.contains('section.pp-account button', /^Pay \$85\.00$/)));
    line('b12-paid', () => look(() => cy.get('.pp-account__note', { timeout: 60000 }), 3500));
    offCamera(() => {
      signIn('cl', `/schedule/clients?clientId=${o.clients.chen}&tab=financial`);
      cy.contains('tr', /48213/, { timeout: 60000 }).contains('Paid');
      cy.contains('tr', /48213/).then(($e) => $e[0].scrollIntoView({ block: 'center' }));
      cy.wait(1500);
    });
    line('b06-scout', () => look(() => cy.contains('tr', /48213/), 4500));
    line('b07-take');
    line('b07b-link');
    line('b13-mistakes');
    line('b14-remember');
    finish();
  });
});

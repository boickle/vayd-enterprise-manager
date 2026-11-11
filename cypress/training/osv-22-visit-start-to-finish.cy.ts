/// <reference types="cypress" />
/**
 * Training video OSV-22: a mail order from a visit, start to finish. TEST stack, EasyPost test key.
 * Setup: Dr. Lane sends Juniper's heartworm chewable to the mail queue from today's visit checkout (as in OSV-05); the
 * bill is unpaid. Mid-video the bill is paid in cash through the TEST API. Riley fills and ships; Robin checks and emails.
 */
import '../support/e2e';
import { look, press, resetStoreData, signIn } from './osvTraining';
import { openOrder, openOrderQuietly, payVisitBillInCash, resetRefills, selectByText, visitMailOrder } from './osvMailFlow';
import { finish, line, loadNarration, offCamera, startClock, tap, typeSlowly } from './trainingKit';

describe('Training: OSV-22 visit order start to finish', () => {
  it('OSV-22', () => {
    let orderId = 0;
    let invoiceId = '';
    loadNarration();
    resetStoreData();
    resetRefills();
    visitMailOrder().then((r) => {
      orderId = r.orderId;
      invoiceId = r.invoiceId;
    });
    signIn('mailteam', '/schedule/mail-orders');
    cy.contains('Mail Order Queue', { timeout: 40000 });
    cy.wait(2000);
    startClock();

    line('v01-why');
    line('v02-filter', () => tap(() => cy.contains('button', /^Needs payment/)));
    line('v03-order', () => {
      openOrder(() => orderId);
      look(() => cy.contains('✓ Approved', { timeout: 20000 }).first(), 3000);
    });
    line('v04-payment', () => look(() => cy.contains('Needs payment').parents('.mail-queue__section, div').first(), 3500));
    line('v04b-wait', () => look(() => cy.contains(/This invoice is from the last hour/, { timeout: 20000 }), 4500));
    offCamera(() => {
      cy.then(() => payVisitBillInCash(invoiceId));
      cy.reload();
      cy.contains('Mail Order Queue', { timeout: 40000 });
      cy.wait(1500);
    });
    line('v05-paid', () => {
      tap(() => cy.contains('button', /^Fill$/));
      openOrder(() => orderId);
    });
    line('v06-office', () => selectByText(/^Filling from office/, /Raleigh/));
    line('v06b-location', () => selectByText(/^Location/, /Office shelf/));
    line('v07-filled', () => press(() => cy.contains('button', /^Mark filled$/)));
    line('v08-ship', () => {
      tap(() => cy.contains('button', /^Ship \/ pickup/, { timeout: 30000 }));
      openOrder(() => orderId);
      typeSlowly(() => cy.contains('label', 'Package weight (oz)', { timeout: 20000 }).find('input'), '6');
    });
    line('v09-rates', () => {
      press(() => cy.contains('button', /^Get cheapest rates$/));
      cy.contains('button', /^Print cheapest label$/, { timeout: 60000 }).should('not.be.disabled');
    });
    line('v10-label', () => press(() => cy.contains('button', /^Print cheapest label$/, { timeout: 60000 }).should('not.be.disabled')));
    offCamera(() => {
      cy.contains('button', 'Void / refund this label', { timeout: 60000 });
      signIn('manager', '/schedule/mail-orders');
      cy.contains('Mail Order Queue', { timeout: 40000 });
      cy.contains('button', /^Check$/).click();
      cy.wait(1000);
      openOrderQuietly(() => orderId);
      cy.contains('button', /^I checked Juniper$/, { timeout: 20000 });
      cy.wait(600);
    });
    line('v11-checked', () => press(() => cy.contains('button', /^I checked Juniper$/)));
    line('v12-tell', () => {
      tap(() => cy.contains('button', /^Contacted$/, { timeout: 30000 }));
      openOrder(() => orderId);
      cy.contains('button', /^Email client$/, { timeout: 20000 });
    });
    line('v12b-email', () => {
      tap(() => cy.contains('button', /^Email client$/));
      cy.contains('button', /^Send email$/, { timeout: 20000 });
    });
    line('v12c-send', () => press(() => cy.contains('button', /^Send email$/)));
    line('v13-done', () => look(() => cy.contains('Client was emailed.', { timeout: 30000 }).parent(), 3000));
    line('v14-mistakes');
    line('v15-remember');
    finish();
  });
});

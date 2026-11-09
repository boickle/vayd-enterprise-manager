/// <reference types="cypress" />
/**
 * Training video OSV-09: second check, then tell the client. TEST stack (email captured, never sent).
 * Setup: Juniper's approved thyroid order, filled and labelled by Riley Brooks (plain clicks, before the clock).
 * Robin Hale, who didn't fill it, does the check and emails Maria.
 */
import '../support/e2e';
import { approvedThyroidOrder, look, openOrderIfClosed, press, resetStoreData, signIn } from './osvTraining';
import { finish, line, loadNarration, startClock, tap } from './trainingKit';

describe('Training: OSV-09 second check', () => {
  it('OSV-09', () => {
    let orderId = 0;
    loadNarration();
    resetStoreData();
    approvedThyroidOrder().then((id) => (orderId = Number(id)));
    // Riley fills it and buys the test label.
    signIn('mailteam', '/schedule/mail-orders');
    cy.contains('button', /^Fill$/, { timeout: 40000 }).click();
    cy.then(() => cy.contains(`#${orderId}`, { timeout: 20000 }).first().click());
    const pick = (label: RegExp, text: RegExp) =>
      cy.contains('label', label).find('select').contains('option', text, { timeout: 30000 }).then(($o) =>
        cy.contains('label', label).find('select').select(String($o.val()))
      );
    pick(/^Filling from office/, /Raleigh/);
    pick(/^Location/, /Office shelf/);
    cy.contains('label', 'Notes for the checker').find('textarea, input').first().type('One bottle, lot TH24117.');
    cy.contains('button', /^Mark filled$/).click();
    cy.contains('button', /^Ship \/ pickup/).click();
    cy.wait(1500);
    cy.get('body').then(($b) => {
      if (!$b.text().includes('Reject + refund + email')) cy.contains(`#${orderId}`).first().click();
    });
    cy.contains('label', 'Package weight (oz)', { timeout: 20000 }).find('input').type('6');
    cy.contains('button', /^Get cheapest rates$/).click();
    cy.contains('button', /^Print cheapest label$/, { timeout: 60000 }).should('not.be.disabled').click();
    // Printing the label moves the order from Ship / pickup to Check: wait for it there.
    cy.contains('No mail orders in this filter yet', { timeout: 90000 });
    cy.contains('button', /^Check$/).click();
    cy.then(() => cy.contains(`#${orderId}`, { timeout: 60000 }));
    // Robin checks.
    signIn('manager', '/schedule/mail-orders');
    cy.contains('Mail Order Queue', { timeout: 40000 });
    cy.wait(2000);
    startClock();

    line('c01-why');
    line('c02-check', () => tap(() => cy.contains('button', /^Check$/)));
    line('c03-order', () => cy.then(() => tap(() => cy.contains(`#${orderId}`, { timeout: 20000 }).first())));
    line('c04-filler', () => look(() => cy.contains(/Filled by Riley Brooks/, { timeout: 20000 }).first(), 4000));
    line('c05-remember');
    line('c06-slip', () => look(() => cy.contains('button', 'Print check slip'), 3000));
    line('c07-checked', () => press(() => cy.contains('button', /^I checked Juniper$/)));
    line('c08-done', () => tap(() => cy.contains('button', /^Contacted$/, { timeout: 30000 })));
    line('c08b-open', () => openOrderIfClosed(() => orderId));
    line('c09-tell', () => look(() => cy.contains('button', /^Email client$/, { timeout: 20000 }).parent(), 4000));
    line('c10-email', () => tap(() => cy.contains('button', /^Email client$/)));
    line('c11-sent', () => look(() => cy.contains('Email — order shipped', { timeout: 20000 }), 3500));
    line('c11b-send', () => press(() => cy.contains('button', /^Send email$/)));
    line('c11c-emailed', () => look(() => cy.contains('Client was emailed.', { timeout: 30000 }).parent(), 3500));
    line('c12-mistakes');
    line('c13-remember');
    finish();
  });
});

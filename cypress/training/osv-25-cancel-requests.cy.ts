/// <reference types="cypress" />
/**
 * Training video OSV-25: cancel requests. TEST stack.
 * Setup: Juniper's heartworm chewable sent to the mail queue from today's visit (as in OSV-05), the bill paid in cash,
 * and Riley marks it filled. A CL requests the cancellation on the bill; Riley cancels and refunds it.
 */
import '../support/e2e';
import { look, osv, press, resetStoreData, signIn } from './osvTraining';
import { openOrder, openOrderQuietly, payVisitBillInCash, resetRefills, visitMailOrder } from './osvMailFlow';
import { finish, line, loadNarration, offCamera, startClock, tap, typeSlowly } from './trainingKit';

describe('Training: OSV-25 cancel requests', () => {
  it('OSV-25', () => {
    const o = osv();
    let orderId = 0;
    loadNarration();
    resetStoreData();
    resetRefills();
    visitMailOrder().then((r) => {
      orderId = r.orderId;
      payVisitBillInCash(r.invoiceId);
    });
    signIn('mailteam', '/schedule/mail-orders');
    cy.contains('Mail Order Queue', { timeout: 40000 });
    cy.contains('button', /^Fill$/).click();
    cy.wait(1000);
    openOrderQuietly(() => orderId);
    cy.contains('label', /^Filling from office/, { timeout: 20000 }).find('select').contains('option', /Raleigh/, { timeout: 30000 });
    cy.contains('label', /^Filling from office/).find('select').then(($s) => {
      const v = [...($s[0] as HTMLSelectElement).options].find((x) => /Raleigh/.test(x.text))!.value;
      cy.wrap($s).select(v);
    });
    cy.contains('label', /^Location/).find('select').contains('option', /Office shelf/, { timeout: 30000 }).then(($opt) => {
      cy.contains('label', /^Location/).find('select').select(String($opt.val()));
    });
    cy.contains('button', /^Mark filled$/).click();
    cy.contains('button', /^Ship \/ pickup/, { timeout: 30000 });
    cy.wait(1500);
    signIn('cl', `/schedule/clients?clientId=${o.clients.rivera}&tab=financial`);
    cy.contains('tr', /Visit/, { timeout: 60000 }).first().click();
    cy.contains('Request cancellation', { timeout: 60000 }).then(($e) => $e[0].scrollIntoView({ block: 'center' }));
    cy.wait(1500);
    startClock();

    line('n01-why');
    line('n02-bill', () => look(() => cy.contains('Request cancellation').parents('.mail-mode, .mail-mode__status').first(), 4000));
    line('n03-request', () => tap(() => cy.contains('button', /^Request cancellation$/)));
    line('n04-reason', () => tap(() => cy.contains('label', 'Client changed their mind')));
    line('n05-note', () => typeSlowly(() => cy.contains('label', 'Note for the mail team').find('textarea, input').first(), 'Maria has extra at home.'));
    line('n06-send', () => tap(() => cy.contains('button', /^Send request$/)));
    line('n07-waiting', () => look(() => cy.contains(/Cancellation requested/, { timeout: 20000 }).first(), 3500));
    offCamera(() => {
      signIn('mailteam', '/schedule/mail-orders');
      cy.contains('Mail Order Queue', { timeout: 40000 });
      cy.wait(1500);
    });
    line('n08-queue', () => tap(() => cy.contains('button', /^Cancel requests/)));
    line('n09-open', () => {
      openOrder(() => orderId);
      look(() => cy.get('section.mail-queue__cancel-decision', { timeout: 20000 }), 3500);
    });
    line('n10-choices', () => look(() => cy.get('section.mail-queue__cancel-decision').find('button').first().parent(), 5000));
    line('n11-cancel', () => press(() => cy.get('section.mail-queue__cancel-decision').contains('button', /^Cancel and refund$/)));
    line('n12-done', () => look(() => cy.contains('Back on the shelf', { timeout: 30000 }).parent(), 5000));
    line('n12b-shelf', () => press(() => cy.contains('button', /^Keep \$[\d.,]+ as account credit$/, { timeout: 30000 })));
    line('n12c-refunded', () => look(() => cy.contains('tr', /Return #/, { timeout: 30000 }).first(), 3500));
    line('n13-mistakes');
    line('n14-remember');
    finish();
  });
});

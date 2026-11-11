/// <reference types="cypress" />
/**
 * Training video OSV-19: Pending client. TEST stack; texts are captured on the stack, never sent.
 * Setup: Maria orders Maple's heartworm chewable (refills on file: Fill). Riley texts her about the address, the
 * order goes on hold, then she answers and Riley clears the hold.
 */
import '../support/e2e';
import { buyAsMaria, look, press, resetStoreData, signIn } from './osvTraining';
import { openOrder, resetRefills } from './osvMailFlow';
import { finish, line, loadNarration, startClock, tap, typeSlowly } from './trainingKit';

describe('Training: OSV-19 pending client', () => {
  it('OSV-19', () => {
    let orderId = 0;
    loadNarration();
    resetStoreData();
    resetRefills();
    buyAsMaria({ tab: 'Prescriptions', item: 'Heartworm & flea chewable', pet: 'Maple', autoship: false }).then((id) => (orderId = Number(id)));
    signIn('mailteam', '/schedule/mail-orders');
    cy.contains('Mail Order Queue', { timeout: 40000 });
    cy.contains('button', /^Fill$/).click();
    cy.wait(2000);
    startClock();

    line('p01-why');
    line('p02-order', () => {
      openOrder(() => orderId);
      look(() => cy.contains('Ship to', { matchCase: false }).parent(), 3000);
    });
    line('p03-panel', () => look(() => cy.contains(/Text \/ email client/i).parent(), 3500));
    line('p04-type', () =>
      typeSlowly(() => cy.get('textarea[placeholder*="Ask about"]'), 'Hi Maria, is 100 Test Lane still the right address for Maple’s order?')
    );
    line('p05-send', () => press(() => cy.contains('button', /Send text \+ put into waiting status/)));
    line('p06-tag', () => tap(() => cy.contains('button', /^Pending client/)));
    line('p07-list', () => look(() => cy.contains('.mail-queue__badge', 'Pending client', { timeout: 20000 }).first(), 3000));
    line('p08-answer', () => openOrder(() => orderId));
    line('p09-clear', () => press(() => cy.contains('button', /^Clear hold$/)));
    line('p10-mark', () => {
      cy.contains('button', /^Fill$/).click();
      openOrder(() => orderId);
      look(() => cy.contains('button', /^Mark pending$/, { timeout: 20000 }), 3000);
    });
    line('p11-not');
    line('p12-mistakes');
    line('p13-remember');
    finish();
  });
});

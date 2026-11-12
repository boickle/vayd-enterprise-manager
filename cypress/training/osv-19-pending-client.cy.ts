/// <reference types="cypress" />
/**
 * Training video OSV-19: Pending client. TEST stack; texts are captured on the stack, never sent.
 * Setup: Maria orders Maple's heartworm chewable (refills on file: Fill). Riley texts her about the address, the
 * order goes on hold, then she answers and Riley clears the hold.
 */
import '../support/e2e';
import { buyAsMaria, look, osv, press, resetStoreData, signIn, sql } from './osvTraining';
import { openOrder, resetRefills } from './osvMailFlow';
import { finish, line, loadNarration, offCamera, startClock, tap, typeSlowly } from './trainingKit';

describe('Training: OSV-19 pending client', () => {
  it('OSV-19', () => {
    let orderId = 0;
    const o = osv();
    // Client replies the fake OpenPhone hands back (training stack only); emptied for each take.
    const inbox = String(Cypress.env('SCH_SMS_CAPTURE')).replace(/[^/]+$/, 'sms-inbox.jsonl');
    cy.writeFile(inbox, '');
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
    offCamera(() => {
      // Maria texts back: what Quo would send the API (message.received), and the text for the message list.
      sql(`SELECT phone1 FROM clients WHERE id=${o.clients.rivera}`).then((p) => {
        const from = `+1${String(p).replace(/\D/g, '').slice(-10)}`;
        const text = 'Yes, 100 Test Lane is still right. Thank you!';
        cy.writeFile(inbox, JSON.stringify({ at: new Date().toISOString(), from, text }) + '\n', { flag: 'a+' });
        cy.request('POST', `${Cypress.env('API_URL')}/webhooks/openphone/message`, {
          type: 'message.received',
          data: { object: { direction: 'incoming', from, to: '+19195550100', text } },
        });
      });
      cy.reload();
      cy.contains('Mail Order Queue', { timeout: 40000 });
      cy.get('[data-testid="pending-client-replies"]', { timeout: 30000 });
      cy.wait(1200);
    });
    line('p07b-reply', () => look(() => cy.get('[data-testid="pending-client-replies"]').parent(), 4000));
    line('p08-answer', () => {
      openOrder(() => orderId);
      look(() => cy.get('[data-testid="mail-text-new"]', { timeout: 30000 }).parent(), 4500);
    });
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

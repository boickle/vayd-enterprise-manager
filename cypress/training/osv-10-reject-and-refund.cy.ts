/// <reference types="cypress" />
/**
 * Training video OSV-10: reject or cancel an order, and refund. TEST stack, Stripe TEST mode (test refund), email
 * captured. Setup: Maria puts Maple's heartworm chewable on auto-ship in the store (paid with the test Visa).
 * Robin Hale rejects it, refunds it and emails Maria from the order.
 */
import '../support/e2e';
import { buyAsMaria, look, press, resetStoreData, signIn } from './osvTraining';
import { finish, line, loadNarration, offCamera, startClock, tap, typeSlowly } from './trainingKit';

describe('Training: OSV-10 reject and refund', () => {
  it('OSV-10', () => {
    let orderId = 0;
    loadNarration();
    resetStoreData();
    buyAsMaria({ tab: 'Prescriptions', item: 'Heartworm & flea chewable', pet: 'Maple', autoship: true }).then((id) => (orderId = Number(id)));
    signIn('manager', '/schedule/mail-orders');
    cy.contains('Mail Order Queue', { timeout: 40000 });
    cy.contains('button', /^All$/).click();
    cy.wait(1500);
    startClock();

    line('r01-why');
    line('r02-search', () => cy.then(() => typeSlowly(() => cy.get('input[placeholder*="Order #"]'), String(orderId))));
    line('r03-order', () => cy.then(() => tap(() => cy.contains(`#${orderId}`, { timeout: 20000 }).first())));
    line('r04-remember');
    line('r05-reject', () => press(() => cy.contains('button', /^Reject \+ refund \+ email$/, { timeout: 20000 })));
    line('r06-what', () => look(() => cy.contains('Refunds the Stripe charge, cancels linked auto-ship', { timeout: 20000 }), 4500));
    line('r07-reason', () => typeSlowly(() => cy.contains('label', 'Internal reason (staff only)').find('textarea, input').first(), 'Client asked to cancel; switching brands.'));
    line('r08-email', () => look(() => cy.contains('label', /^To/).parent(), 3500));
    line('r09-send', () => press(() => cy.contains('button', /^Send email$/)));
    offCamera(() => {
      cy.contains('button', /^Rejected/, { timeout: 60000 }).click();
      cy.wait(1200);
    });
    line('r10-rejected', () => cy.then(() => look(() => cy.contains(`#${orderId}`, { timeout: 20000 }).parents('.mail-queue__card, article').first(), 5000)));
    line('r11-cancel-requests', () => look(() => cy.contains('button', /^Cancel requests/), 3500));
    line('r12-mistakes');
    line('r13-remember');
    finish();
  });
});

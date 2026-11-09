/// <reference types="cypress" />
/**
 * Training video OSV-06: take a phone order. TEST stack, Stripe TEST mode.
 * Casey Morgan (CL) puts joint chews for Juniper on a new bill on Maria's Financial tab, sends it by Mail order,
 * and charges Maria's saved test Visa (saved by a store order bought before the clock starts).
 */
import '../support/e2e';
import { buyAsMaria, look, osv, press, resetStoreData, signIn, sql } from './osvTraining';
import { choose, finish, line, loadNarration, startClock, tap, typeSlowly } from './trainingKit';

describe('Training: OSV-06 phone order', () => {
  it('OSV-06', () => {
    const o = osv();
    loadNarration();
    resetStoreData();
    sql(`UPDATE visit_invoices SET "isDeleted"=true WHERE "clientId"=${o.clients.rivera} AND "isDeleted"=false`);
    buyAsMaria({ tab: 'Dental', item: 'Dental chews', pet: 'Maple', autoship: false });
    signIn('cl', `/schedule/clients?clientId=${o.clients.rivera}&tab=financial`);
    cy.contains('button', /^New invoice$/, { timeout: 60000 });
    cy.wait(2000);
    startClock();

    line('p01-why');
    line('p02-new', () => press(() => cy.contains('button', /^New invoice$/)));
    line('p03-add', () => typeSlowly(() => cy.get('input[placeholder^="Add a charge for"]', { timeout: 20000 }).first(), 'Joint'));
    line('p03b-pick', () => {
      tap(() => cy.contains(/Joint support chews \(60 ct\)/, { timeout: 20000 }).first());
    });
    line('p04-remember');
    line('p05-mail', () => press(() => cy.get('.mail-mode__toggle', { timeout: 20000 }).first().contains('button', /^Mail order/)));
    line('p06-ship', () => {
      cy.contains('h3', 'Send to mail queue', { timeout: 15000 });
      choose(() => cy.contains('label', 'Shipping / pick-up type').find('select'), 'ship-499');
    });
    line('p07-pay-now', () => look(() => cy.contains('.mail-order-prompt__check', 'Take payment now'), 3000));
    line('p08-add', () => tap(() => cy.contains('button', /^Add to mail queue$/)));
    line('p09-card', () => look(() => cy.contains('option', /^Card on file/).parent('select'), 4000));
    line('p10-charge', () => press(() => cy.contains('button', /^Charge card on file$/)));
    line('p11-paid', () => look(() => cy.get('.mail-mode', { timeout: 30000 }).first(), 4500));
    line('p12-mistakes');
    line('p13-remember');
    finish();
  });
});

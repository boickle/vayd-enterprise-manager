/// <reference types="cypress" />
/**
 * Training video OSV-17: the Mail Order Queue at a glance. TEST stack, Stripe TEST mode.
 * Setup: Maria orders Maple's heartworm chewable (refills on file: Fill) and Juniper's thyroid tablets (no refills:
 * Needs approval); a dental chews order is marked Pending client in the TEST database.
 */
import '../support/e2e';
import { buyAsMaria, look, resetStoreData, signIn, sql, osv } from './osvTraining';
import { resetRefills } from './osvMailFlow';
import { finish, line, loadNarration, startClock, tap } from './trainingKit';

describe('Training: OSV-17 queue at a glance', () => {
  it('OSV-17', () => {
    const o = osv();
    loadNarration();
    resetStoreData();
    resetRefills();
    buyAsMaria({ tab: 'Prescriptions', item: 'Heartworm & flea chewable', pet: 'Maple', autoship: false });
    buyAsMaria({ tab: 'Prescriptions', item: 'Thyroid tablets', pet: 'Juniper', autoship: false });
    buyAsMaria({ tab: 'Dental', item: 'Dental chews', pet: 'Maple', autoship: false }).then((id) =>
      sql(`UPDATE mail_orders SET "clientQuestionPendingAt"=now() WHERE id=${id} AND "clientId"=${o.clients.rivera}`)
    );
    signIn('mailteam', '/schedule/mail-orders');
    cy.contains('Mail Order Queue', { timeout: 40000 });
    cy.wait(2000);
    startClock();

    line('q01-why');
    line('q02-open', () => look(() => cy.get('article.mail-queue__card, .mail-queue__card').first().parent(), 4000));
    line('q03-steps', () => look(() => cy.get('.mail-queue__card').first(), 5000));
    line('q04-cancel', () => tap(() => cy.contains('button', /^Cancel requests/)));
    line('q05-approval', () => tap(() => cy.contains('button', /^Needs approval/)));
    line('q06-pending', () => tap(() => cy.contains('button', /^Pending client/)));
    line('q07-payment', () => tap(() => cy.contains('button', /^Needs payment/)));
    line('q08-fill', () => tap(() => cy.contains('button', /^Fill$/)));
    line('q09-check', () => tap(() => cy.contains('button', /^Check$/)));
    line('q10-contacted', () => tap(() => cy.contains('button', /^Contacted$/)));
    line('q11-search', () => look(() => cy.get('input[placeholder*="Order #"]'), 3000));
    line('q12-mistakes');
    line('q13-remember');
    finish();
  });
});

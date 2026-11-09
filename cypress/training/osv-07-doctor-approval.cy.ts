/// <reference types="cypress" />
/**
 * Training video OSV-07: approve, send back or decline a prescription mail order. TEST stack, Stripe TEST mode.
 * Setup: Maria orders 3 bottles of Juniper's thyroid tablets in the store (no refills left). Robin sends the approval
 * task to Dr. Lane; Dr. Lane approves 1, and Scout refunds 2 to the test card.
 */
import '../support/e2e';
import { buyAsMaria, look, press, resetStoreData, signIn } from './osvTraining';
import { choose, finish, line, loadNarration, offCamera, pointAt, startClock, tap, typeSlowly } from './trainingKit';

describe('Training: OSV-07 doctor approval', () => {
  it('OSV-07', () => {
    let orderId = 0;
    loadNarration();
    resetStoreData();
    buyAsMaria({ tab: 'Prescriptions', item: 'Thyroid tablets', pet: 'Juniper', autoship: false, qty: 3 }).then((id) => (orderId = id));
    signIn('manager', '/schedule/mail-orders');
    cy.contains('Mail Order Queue', { timeout: 40000 });
    cy.wait(2000);
    startClock();

    line('d01-why');
    line('d02-filter', () => tap(() => cy.contains('button', /^Needs approval/)));
    line('d03-order', () => cy.then(() => tap(() => cy.contains(`#${orderId}`, { timeout: 20000 }).first())));
    line('d04-not-here', () => look(() => cy.contains('Approval decisions live on the assigned task', { timeout: 20000 }), 4000));
    line('d05-send-to', () =>
      cy.contains('label', /^Send to/).find('select').then(($sel) => {
        const lane = [...($sel[0] as HTMLSelectElement).options].find((x) => /Lane/.test(x.text) && x.value);
        choose(() => cy.contains('label', /^Send to/).find('select'), lane!.value);
      })
    );
    line('d06-send', () => tap(() => cy.contains('button', /^Send task$/)));
    offCamera(() => {
      cy.contains(/Task sent|sent to/i, { timeout: 20000 });
      signIn('doctorA', '/schedule/tasks');
      cy.contains(/Active \([1-9]/, { timeout: 40000 });
      cy.wait(1000);
    });
    line('d07-task', () => cy.then(() => press(() => cy.contains(new RegExp(`Approve mail order #${orderId}`)).first())));
    line('d08-remember');
    line('d09-what', () => look(() => cy.contains(/Thyroid tablets 0\.4 mg \(90 ct\) × 3/, { timeout: 20000 }).first(), 4000));
    // Owner (Nov 9): click it on camera. It sends the demo chart only to the AI service.
    line('d10-summary', () => press(() => cy.contains('button', 'Summarize Case')));
    line('d10b-summary', () => look(() => cy.get('.pims-task-mail__summary', { timeout: 60000 }), 5000));
    line('d11-directions', () => look(() => cy.contains('label, h3, h4, legend', /^Directions/).parent(), 3500));
    line('d12-chronic', () => tap(() => cy.contains('button', /^Chronic$/)));
    line('d13-qty', () => {
      cy.contains('label', 'Quantity to approve').find('input').then(($i) => $i[0].scrollIntoView({ block: 'center' }));
      cy.wait(250);
      tap(() => cy.contains('label', 'Quantity to approve').find('input'));
      cy.contains('label', 'Quantity to approve').find('input').clear();
      typeSlowly(() => cy.contains('label', 'Quantity to approve').find('input'), '1');
    });
    line('d14-refund', () => look(() => cy.contains(/Scout refunds the difference/), 4500));
    line('d15-other', () => look(() => cy.contains('button', /^Send back$/), 3000));
    line('d16-approve', () => press(() => cy.contains('button', /^Approve$/)));
    offCamera(() => {
      cy.wait(2500);
      signIn('manager', '/schedule/mail-orders');
      cy.contains('Mail Order Queue', { timeout: 40000 });
      cy.contains('button', /^All$/).click();
      cy.then(() => {
        cy.get('input[placeholder*="Order #"]', { timeout: 30000 }).clear().type(String(orderId));
        cy.wait(2000);
        cy.contains(`#${orderId}`).first().click({ force: true });
      });
      cy.contains(/Stripe refund/, { timeout: 20000 });
      cy.wait(800);
    });
    line('d17-refund-note', () => look(() => cy.contains(/Stripe refund/).first(), 5000));
    line('d18-mistakes');
    line('d19-remember');
    finish();
  });
});

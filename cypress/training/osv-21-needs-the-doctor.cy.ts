/// <reference types="cypress" />
/**
 * Training video OSV-21: an online order that needs the doctor (no refills left). TEST stack, Stripe TEST mode.
 * Setup: Maria orders Juniper's thyroid tablets (Rx with no refills). Robin sends the approval task; Dr. Lane approves.
 */
import '../support/e2e';
import { buyAsMaria, look, press, resetStoreData, signIn } from './osvTraining';
import { openOrder, resetRefills } from './osvMailFlow';
import { choose, finish, line, loadNarration, offCamera, startClock, tap } from './trainingKit';

describe('Training: OSV-21 needs the doctor', () => {
  it('OSV-21', () => {
    let orderId = 0;
    loadNarration();
    resetStoreData();
    resetRefills();
    buyAsMaria({ tab: 'Prescriptions', item: 'Thyroid tablets', pet: 'Juniper', autoship: false }).then((id) => (orderId = Number(id)));
    signIn('manager', '/schedule/mail-orders');
    cy.contains('Mail Order Queue', { timeout: 40000 });
    cy.wait(2000);
    startClock();

    line('a01-why');
    line('a02-filter', () => tap(() => cy.contains('button', /^Needs approval/)));
    line('a03-order', () => openOrder(() => orderId));
    line('a04-norefills', () => look(() => cy.contains(/0 left on prior Rx/, { timeout: 20000 }).first(), 3000));
    line('a05-send-to', () =>
      cy.contains('label', /^Send to/).find('select').then(($sel) => {
        const lane = [...($sel[0] as HTMLSelectElement).options].find((x) => /Lane/.test(x.text) && x.value);
        choose(() => cy.contains('label', /^Send to/).find('select'), lane!.value);
      })
    );
    line('a06-send', () => tap(() => cy.contains('button', /^Send task$/)));
    offCamera(() => {
      cy.contains(/Task sent|sent to/i, { timeout: 20000 });
      signIn('doctorA', '/schedule/tasks');
      cy.contains(/Active \([1-9]/, { timeout: 40000 });
      cy.wait(1000);
    });
    line('a07-task', () => cy.then(() => press(() => cy.contains(new RegExp(`Approve mail order #${orderId}`)).first())));
    line('a08-directions', () => look(() => cy.contains('label, h3, h4, legend', /^Directions/, { timeout: 20000 }).parent(), 3500));
    line('a09-chronic', () => tap(() => cy.contains('button', /^Chronic$/)));
    line('a10-approve', () => press(() => cy.contains('button', /^Approve$/)));
    offCamera(() => {
      cy.wait(2500);
      signIn('manager', '/schedule/mail-orders');
      cy.contains('Mail Order Queue', { timeout: 40000 });
      cy.wait(1000);
    });
    line('a11-fill', () => tap(() => cy.contains('button', /^Fill$/)));
    line('a11b-open', () => {
      openOrder(() => orderId);
      look(() => cy.contains('✓ Approved', { timeout: 20000 }).first(), 2500);
    });
    line('a12-same');
    line('a13-mistakes');
    line('a14-remember');
    finish();
  });
});

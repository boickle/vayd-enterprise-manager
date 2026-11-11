/// <reference types="cypress" />
/**
 * Training video OSV-08: fill an order and print its label. TEST stack (Stripe TEST mode, EasyPost test key).
 * Setup: Juniper's thyroid order, paid and approved by Dr. Lane (lot-tracked, lot TH24117 in Raleigh office).
 * Riley Brooks (mail order team) fills it from the Raleigh office shelf and buys one test label.
 */
import '../support/e2e';
import { approvedThyroidOrder, look, press, resetStoreData, signIn } from './osvTraining';
import { choose, finish, line, loadNarration, startClock, tap, typeSlowly } from './trainingKit';

describe('Training: OSV-08 fill and label', () => {
  it('OSV-08', () => {
    let orderId = 0;
    loadNarration();
    resetStoreData();
    approvedThyroidOrder().then((id) => (orderId = Number(id)));
    signIn('mailteam', '/schedule/mail-orders');
    cy.contains('Mail Order Queue', { timeout: 40000 });
    cy.wait(2000);
    startClock();
    const selectByText = (label: RegExp, text: RegExp) =>
      cy.contains('label', label).find('select').contains('option', text, { timeout: 30000 }).parent('select').then(($sel) => {
        const opt = [...($sel[0] as HTMLSelectElement).options].find((x) => text.test(x.text) && x.value);
        choose(() => cy.contains('label', label).find('select'), opt!.value);
      });

    // Switching filters sometimes keeps the order open, sometimes not: open it only when it's closed.
    const openIfClosed = () =>
      cy.wait(100).then(() => {
        if (!Cypress.$('body').text().includes('Reject + refund + email')) tap(() => cy.contains(`#${orderId}`, { timeout: 20000 }).first());
      });

    line('f01-why');
    line('f02-fill', () => tap(() => cy.contains('button', /^Fill$/)));
    line('f03-order', () => cy.then(() => tap(() => cy.contains(`#${orderId}`, { timeout: 20000 }).first())));
    line('f04-steps', () => look(() => cy.contains('Choose where the stock comes from', { timeout: 20000 }), 4500));
    line('f05-office', () => selectByText(/^Filling from office/, /Raleigh/));
    line('f06-location', () => selectByText(/^Location/, /Office shelf/));
    line('f07-remember');
    line('f08-item', () => look(() => cy.contains(/Thyroid tablets 0\.4 mg \(90 ct\) × 1/).first(), 3500));
    line('f09-lot', () => look(() => cy.contains('option', /Lot TH24117/, { timeout: 20000 }).parent('select'), 4500));
    line('f13-notes', () => typeSlowly(() => cy.contains('label', 'Notes for the checker').find('textarea, input').first(), 'One bottle, lot TH24117.'));
    line('f10-labels', () => look(() => cy.contains('button', 'Print Rx + bag labels').first(), 3000));
    line('f11-wrong', () => look(() => cy.contains('button', /^Re-send…$/).first(), 3500));
    line('f12-pending', () => look(() => cy.contains('button', /^Mark pending$/).first(), 3000));
    line('f14-filled', () => press(() => cy.contains('button', /^Mark filled$/)));
    line('f15-done', () => tap(() => cy.contains('button', /^Ship \/ pickup/, { timeout: 30000 })));
    line('f15b-open', () => openIfClosed());
    line('f15c-filled', () => look(() => cy.contains(/✓ Filled/, { timeout: 30000 }).first(), 3000));
    line('f16-weight', () => typeSlowly(() => cy.contains('label', 'Package weight (oz)').find('input'), '6'));
    line('f17-rates', () => press(() => cy.contains('button', /^Get cheapest rates$/)));
    line('f18-print', () => press(() => cy.contains('button', /^Print cheapest label$/, { timeout: 60000 }).should('not.be.disabled')));
    line('f19-printed', () => tap(() => cy.contains('button', /^Check$/, { timeout: 60000 })));
    line('f19b-chip', () => openIfClosed());
    line('f20-void', () => look(() => cy.contains('button', 'Void / refund this label').first(), 4000));
    line('f21-mistakes');
    line('f22-remember');
    finish();
  });
});

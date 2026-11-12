/// <reference types="cypress" />
/**
 * Training video, INV-05: when a card is declined
 * (docs/training/scripts/invoicing/INV-05-card-declined.md). TEST stack on Stripe TEST mode. Demo names only: Tom Chen
 * and Biscuit. Tom's saved card is Stripe's test card that declines (4000 0000 0000 0341); the card typed first is
 * 4000 0000 0000 0002, which also declines. Needs invoicing-demo.sql.
 */
import '../support/e2e';
import { schedulingApi, schedulingWorld, signInAsScheduling } from '../support/schedulingWorld';
import { catalogId, giveSavedCard, openVisit, resetInvoicingWorld, setBillBranch, stripeField } from './invKit';
import { finish, line, loadNarration, offCamera, pointAt, startClock, tap, typeSlowly } from './trainingKit';

describe('Training: INV-05 card declined', () => {
  it('INV-05', () => {
    const w = schedulingWorld();
    const biscuit = w.households.B.petId;
    const client = w.households.B.clientId;
    const pid = w.practiceId;
    loadNarration();
    resetInvoicingWorld();
    // Tom's saved card is a test card that always declines (a fresh email, so Stripe holds only this card).
    giveSavedCard(client, `tom.chen.inv05.${Date.now()}@example.com`, 'Tom Chen', 'pm_card_chargeCustomerFail');

    let appt = 0;
    openVisit(biscuit, client, 'Office exam', 90).then(({ appt: a, enc }) => {
      appt = a;
      schedulingApi('cl', 'POST', '/visit-invoices', { practiceId: pid, appointmentId: a, clientId: client }).then(() => {
        setBillBranch(client);
        catalogId('Office exam').then((c) =>
          schedulingApi('doctorA', 'POST', `/soap-encounters/${enc}/orders`, {
            practiceId: pid, name: 'Office exam', catalogItemId: c.id, catalogItemType: c.type, qty: 1, kind: 'treatment', state: 'accepted', unitPrice: 75,
          })
        );
      });
    });
    cy.then(() => signInAsScheduling('cl', `/schedule/soap/${appt}/${biscuit}/checkout?clientId=${client}`));
    cy.contains('.soap-invoice-row.total', '$75.00', { timeout: 60000 }).should('exist');
    cy.contains('.soap-checkout-actions button', 'Card on file', { timeout: 60000 }).should('not.be.disabled');
    cy.wait(1500);

    const btn = (label: string) => cy.contains('.soap-checkout-actions button', label);
    const card = '.virtual-terminal__card';
    startClock();

    line('inv05-01');
    line('inv05-02', () => pointAt(() => btn('Card on file'), 3500));
    line('inv05-03');
    line('inv05-04', () => tap(() => btn('Card on file')));
    offCamera(() => cy.contains('Your card was declined', { timeout: 90000 }).should('exist'));
    line('inv05-05', () => pointAt(() => cy.contains('Your card was declined'), 4000));
    line('inv05-06', () => pointAt(() => cy.get('.soap-invoice-row.total'), 3500));
    line('inv05-07');
    line('inv05-tap1', () => pointAt(() => btn('Tap to Pay'), 4000));
    line('inv05-tap2');
    line('inv05-08', () => {
      tap(() => btn('Type card manually'));
      cy.contains('h3', 'Type card manually').should('be.visible');
    });
    line('inv05-09', () => {
      cy.get('.virtual-terminal__field input').first().clear();
      typeSlowly(() => cy.get('.virtual-terminal__field input').first(), 'Tom Chen');
    });
    line('inv05-10', () => {
      pointAt(() => cy.get(card), 1500);
      stripeField(card, 'cardnumber', '4000000000000002');
    });
    line('inv05-11', () => stripeField(card, 'exp-date', '1234'));
    line('inv05-12', () => stripeField(card, 'cvc', '123'));
    line('inv05-13', () => stripeField(card, 'postal', '27513'));
    line('inv05-14', () => tap(() => cy.get('.virtual-terminal__actions .btn.primary')));
    offCamera(() => cy.get('.virtual-terminal__error', { timeout: 90000 }).should('be.visible'));
    line('inv05-15', () => pointAt(() => cy.get('.virtual-terminal__error'), 5000));
    line('inv05-16', () => {
      tap(() => cy.contains('.virtual-terminal__actions button', 'Cancel'));
      cy.get('.virtual-terminal').should('not.exist');
    });
    line('inv05-16b', () => {
      tap(() => btn('Type card manually'));
      cy.contains('h3', 'Type card manually').should('be.visible');
    });
    line('inv05-16c', () => {
      cy.get('.virtual-terminal__field input').first().clear();
      typeSlowly(() => cy.get('.virtual-terminal__field input').first(), 'Tom Chen');
    });
    line('inv05-16d', () => {
      pointAt(() => cy.get(card), 1200);
      stripeField(card, 'cardnumber', '4242424242424242');
    });
    line('inv05-16e', () => stripeField(card, 'exp-date', '1234'));
    line('inv05-16f', () => stripeField(card, 'cvc', '123'));
    line('inv05-16g', () => stripeField(card, 'postal', '27513'));
    line('inv05-17', () => tap(() => cy.get('.virtual-terminal__actions .btn.primary')));
    offCamera(() => cy.contains('Card charged — invoice marked paid', { timeout: 90000 }).should('exist'));
    line('inv05-18', () => pointAt(() => cy.contains('Card charged — invoice marked paid'), 4000));
    line('inv05-19', () => {
      cy.contains('Your card was declined').should('not.exist');
      pointAt(() => cy.contains('.soap-invoice-row', 'Paid'), 4000);
    });
    line('inv05-20');
    line('inv05-21');
    finish();
  });
});

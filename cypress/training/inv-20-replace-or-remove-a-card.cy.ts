/// <reference types="cypress" />
/**
 * Training video, INV-20: replace or remove a card on file
 * (docs/training/scripts/invoicing/INV-20-replace-or-remove-a-card.md). TEST stack on Stripe TEST mode (TRAINING_STRIPE=test):
 * Maria Rivera starts with Stripe's test Visa 4242 and replaces it with the test Mastercard 4444. Demo names only.
 * The membership-on-another-card note and the expired card are voice-over only (Stripe test mode can't make an expired card).
 */
import '../support/e2e';
import { schedulingWorld, signInAsScheduling } from '../support/schedulingWorld';
import { giveSavedCard, resetInvoicingWorld, sql, stripeField } from './invKit';
import { finish, line, loadNarration, pointAt, startClock, tap, typeSlowly } from './trainingKit';

describe('Training: INV-20 replace or remove a card', () => {
  it('INV-20', () => {
    const w = schedulingWorld();
    const client = w.households.A.clientId;
    loadNarration();
    resetInvoicingWorld();
    // A fresh Stripe test customer per take, with Visa 4242 saved at a visit under the current agreement.
    giveSavedCard(client, `maria.rivera.inv20.${Date.now()}@example.com`, 'Maria Rivera');
    sql(`UPDATE clients SET "cardOnFileConsentSource"='terminal' WHERE id=${client}`);

    cy.then(() => signInAsScheduling('cl', `/schedule/clients?clientId=${client}&tab=financial`));
    const section = () => cy.get('section[aria-label="Card on file"]', { timeout: 60000 });
    section().contains('Visa ending 4242', { timeout: 60000 }).should('exist');
    section().contains('Owner agreed').should('exist');
    cy.wait(1500);
    startClock();

    line('inv20-01');
    line('inv20-02', () => pointAt(() => section().find('.client-card__card'), 4000));
    line('inv20-03', () => pointAt(() => section().find('.client-card__muted').first(), 4500));
    line('inv20-04');
    line('inv20-05', () => {
      tap(() => section().contains('button', 'Replace card'));
      section().find('.client-card__box iframe', { timeout: 60000 }).should('exist');
    });
    line('inv20-06', () => {
      typeSlowly(() => section().find('.client-card__field input').first(), 'Maria Rivera');
      stripeField('.client-card__box', 'cardnumber', '5555555555554444');
      stripeField('.client-card__box', 'exp-date', '1234');
      stripeField('.client-card__box', 'cvc', '123');
      stripeField('.client-card__box', 'postal', '27606');
    });
    line('inv20-07', () => pointAt(() => section().find('.client-card__consent'), 4500));
    line('inv20-07b', () => {
      tap(() => section().find('.client-card__consent input'));
      section().find('.client-card__consent input').should('be.checked');
    });
    line('inv20-08', () => {
      tap(() => section().contains('button', 'Save card'));
      section().contains('New card saved. Nothing was charged.', { timeout: 90000 }).should('exist');
    });
    line('inv20-09', () => pointAt(() => section().find('.client-card__card'), 4500));
    line('inv20-10');
    line('inv20-11', () => {
      tap(() => section().contains('button', 'Remove card'));
      section().contains('Why is the card being removed?').should('be.visible');
    });
    line('inv20-12', () => pointAt(() => section().contains('.client-card__muted', 'Removes the card everywhere'), 5000));
    line('inv20-13', () => {
      typeSlowly(() => section().find('.client-card__field input'), 'Owner asked us to remove it');
      tap(() => section().find('.client-card__form').contains('button', 'Remove card'));
      section().contains('No card on file', { timeout: 60000 }).should('exist');
    });
    line('inv20-14', () => pointAt(() => section().find('.client-card__card'), 3500));
    line('inv20-15');
    line('inv20-16');
    line('inv20-17');
    finish();
  });
});

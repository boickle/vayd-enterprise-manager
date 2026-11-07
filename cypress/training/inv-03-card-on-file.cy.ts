/// <reference types="cypress" />
/**
 * Training video, INV-03: save a card and charge the card on file
 * (docs/training/scripts/invoicing/INV-03-card-on-file.md). TEST stack on Stripe TEST mode (TRAINING_STRIPE=test) with
 * Stripe's test Visa 4242. Demo names only: Maria Rivera and Maple. Needs invoicing-demo.sql.
 */
import '../support/e2e';
import { schedulingApi, schedulingWorld, signInAsScheduling } from '../support/schedulingWorld';
import { catalogId, openVisit, resetInvoicingWorld, setBillBranch, sql, stripeField } from './invKit';
import { finish, line, loadNarration, offCamera, pointAt, startClock, tap, typeSlowly } from './trainingKit';

describe('Training: INV-03 card on file', () => {
  it('INV-03', () => {
    const w = schedulingWorld();
    const [maple] = w.households.A.activePetIds;
    const client = w.households.A.clientId;
    const pid = w.practiceId;
    loadNarration();
    resetInvoicingWorld();
    // The Riveras have no card saved and no recorded refusal.
    // Stripe finds saved cards by the client's email, so each take uses a fresh Rivera email that Stripe has never seen.
    sql(`UPDATE clients SET email='maria.rivera.inv03.${Date.now()}@example.com', "stripeCustomerId"=NULL, "savedPaymentMethodId"=NULL, "cardOnFileConsentAt"=NULL, "cardOnFileDeclinedAt"=NULL, "cardOnFileConsentAgreementVersion"=NULL WHERE id=${client}`);

    // A visit with a bill: charge items straight onto the open bill (setup, before the clock).
    const bill = (minutesAgo: number, items: [string, number][]) =>
      openVisit(maple, client, 'Visit', minutesAgo).then(({ appt, enc }) => {
        schedulingApi('cl', 'POST', '/visit-invoices', { practiceId: pid, appointmentId: appt, clientId: client }).then(() => {
          setBillBranch(client);
          items.forEach(([name, price]) =>
            catalogId(name).then((c) =>
              schedulingApi('doctorA', 'POST', `/soap-encounters/${enc}/orders`, {
                practiceId: pid, name, catalogItemId: c.id, catalogItemType: c.type, qty: 1, kind: 'treatment', state: 'accepted', unitPrice: price,
              })
            )
          );
        });
        return cy.then(() => appt);
      });
    const page = (appt: number) => `/schedule/soap/${appt}/${maple}/checkout?clientId=${client}`;
    let first = 0;
    bill(90, [['Nail trim', 22.5], ['Dental X-rays', 162]]).then((a) => (first = a));
    cy.then(() => signInAsScheduling('cl', page(first)));
    cy.contains('button', 'Card over phone', { timeout: 60000 }).should('exist');
    cy.contains('.soap-invoice-row.total', '$184.50', { timeout: 60000 }).should('exist');
    cy.wait(1500);

    const btn = (label: string) => cy.contains('.soap-checkout-actions button', label);
    startClock();

    line('inv03-01');
    line('inv03-02', () => pointAt(() => btn('Card on file'), 4000));
    line('inv03-03', () => pointAt(() => cy.get('.soap-checkout-consent'), 5000));
    line('inv03-04');
    line('inv03-05', () => {
      tap(() => btn('Card over phone'));
      cy.contains('h3', 'Card over the phone').should('be.visible');
    });
    line('inv03-06', () => {
      cy.get('.virtual-terminal__field input').first().clear();
      typeSlowly(() => cy.get('.virtual-terminal__field input').first(), 'Maria Rivera');
    });
    line('inv03-07', () => {
      pointAt(() => cy.get('.virtual-terminal__card'), 1500);
      stripeField('.virtual-terminal__card', 'cardnumber', '4242424242424242');
    });
    line('inv03-08', () => stripeField('.virtual-terminal__card', 'exp-date', '1234'));
    line('inv03-09', () => stripeField('.virtual-terminal__card', 'cvc', '123'));
    line('inv03-10', () => stripeField('.virtual-terminal__card', 'postal', '27606'));
    line('inv03-11', () => tap(() => cy.get('.virtual-terminal__check')));
    line('inv03-12', () => tap(() => cy.get('.virtual-terminal__actions .btn.primary')));
    offCamera(() => cy.contains('Card charged over the phone', { timeout: 90000 }).should('exist'));
    line('inv03-13', () => pointAt(() => cy.contains('Card charged over the phone'), 4500));
    line('inv03-14', () => pointAt(() => cy.get('.soap-invoice-badge'), 3500));
    // Later that day: a second visit and a small bill for Maple.
    let second = 0;
    offCamera(() => {
      bill(30, [['Nail trim', 22.5]]).then((a) => (second = a));
      cy.then(() => cy.visit(page(second)));
      cy.contains('.soap-checkout-actions button', 'Card on file', { timeout: 60000 }).should('not.be.disabled');
      cy.wait(1500);
    });
    line('inv03-15', () => pointAt(() => btn('Card on file'), 4500));
    line('inv03-16', () => tap(() => btn('Card on file')));
    offCamera(() => cy.contains('Charged the card on file', { timeout: 90000 }).should('exist'));
    line('inv03-17', () => pointAt(() => cy.contains('Charged the card on file'), 4500));
    line('inv03-18');
    finish();
  });
});

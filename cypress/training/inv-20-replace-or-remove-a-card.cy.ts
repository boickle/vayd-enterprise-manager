/// <reference types="cypress" />
/**
 * Training video, INV-20: replace or remove a card on file
 * (docs/training/scripts/invoicing/INV-20-replace-or-remove-a-card.md). TEST stack on Stripe TEST mode
 * (TRAINING_STRIPE=test): Stripe's test Visa 4242 on file, the test Mastercard 4444 typed in. Demo names only.
 * Needs invoicing-demo.sql (Maple's plan). Steps 13 and 14 (an expired card): Stripe test mode refuses a past
 * expiry date, so the stack's expired-card-preload.cjs reports Tom's test card as expired last month (owner, Nov 13,
 * 2026, Q20-1 option b).
 */
import '../support/e2e';
import { schedulingApi, schedulingWorld, signInAsScheduling } from '../support/schedulingWorld';
import { catalogId, giveSavedCard, openVisit, resetInvoicingWorld, setBillBranch, sql, stripeField } from './invKit';
import { finish, line, loadNarration, offCamera, pointAt, startClock, tap, typeSlowly } from './trainingKit';

describe('Training: INV-20 replace or remove a card', () => {
  it('INV-20', () => {
    const w = schedulingWorld();
    const client = w.households.A.clientId;
    const [maple] = w.households.A.activePetIds;
    loadNarration();
    resetInvoicingWorld();
    // Maria: the test Visa on file, saved by staff under the current agreement; Maple's plan billed on it in Stripe.
    const email = `maria.rivera.inv20.${Date.now()}@example.com`;
    const apiDir = String(Cypress.env('SCH_API_DIR'));
    cy.exec(`bash cypress/training/setup/stripe-inv20.sh "${apiDir}" "${email}" "Maria Rivera"`, { timeout: 120000 }).then((r) => {
      const [cus, pm, sub] = r.stdout.trim().split(/\s+/);
      expect(cus, 'Stripe customer').to.match(/^cus_/);
      expect(pm, 'Stripe payment method').to.match(/^pm_/);
      expect(sub, 'Stripe subscription').to.match(/^sub_/);
      sql(
        `UPDATE clients SET email='${email}', "stripeCustomerId"='${cus}', "savedPaymentMethodId"='${pm}', "cardOnFileConsentAt"=now() - interval '1 day', "cardOnFileConsentAgreementVersion"='2026-11-12', "cardOnFileConsentSource"='manual', "cardOnFileDeclinedAt"=NULL WHERE id=${client}`
      );
      sql(`UPDATE wellness_plans SET "stripeSubscriptionId"='${sub}' WHERE "patientId"=${maple} AND "pimsType"='inv-train'`);
    });
    // Tom: a saved test card the stack reports as expired, and an open bill for Biscuit (Office exam $75).
    const tom = w.households.B.clientId;
    const biscuit = w.households.B.petId;
    const stackDir = String(Cypress.env('EMAIL_CAPTURE_PATH')).replace(/\/[^/]+$/, '');
    giveSavedCard(tom, `tom.chen.inv20.${Date.now()}@example.com`, 'Tom Chen');
    sql(`UPDATE clients SET "cardOnFileConsentSource"='manual' WHERE id=${tom}`);
    // Tom's open demo eVet bill would open on the Financial tab and hide Card on file. Unlinked for this take only
    // (not deleted, which would show a red Deleted row); invoicing-demo.sql links it back before the next video.
    sql(`UPDATE invoices SET "clientId"=NULL WHERE "pimsId"='inv-train-evet-48213'`);
    sql(`SELECT "savedPaymentMethodId" FROM clients WHERE id=${tom}`).then((pm) => cy.writeFile(`${stackDir}/expired-pms.txt`, `${String(pm).trim()}\n`));
    let chenVisit = 0;
    cy.then(() => signInAsScheduling('cl', `/schedule/clients?clientId=${client}&tab=financial`));
    const section = () => cy.get('section[aria-label="Card on file"]', { timeout: 60000 });
    section().contains('Visa ending 4242').should('exist');
    section().scrollIntoView({ offset: { top: -160, left: 0 } });
    cy.wait(1500);

    startClock();
    line('inv20-01');
    line('inv20-02', () => pointAt(() => section().find('.client-card__card'), 4000));
    line('inv20-03', () => pointAt(() => section().contains('.client-card__muted', 'Owner agreed'), 4500));
    line('inv20-04', () => tap(() => section().contains('button', 'Replace card')));
    line('inv20-05', () => {
      offCamera(() => section().find('.client-card__box iframe', { timeout: 60000 }).should('exist'));
      section().find('.client-card__entry input').first().should('have.value', 'Maria Rivera');
      stripeField('section[aria-label="Card on file"] .client-card__box', 'cardnumber', '5555555555554444');
      stripeField('section[aria-label="Card on file"] .client-card__box', 'exp-date', '1234');
      stripeField('section[aria-label="Card on file"] .client-card__box', 'cvc', '123');
      stripeField('section[aria-label="Card on file"] .client-card__box', 'postal', '27606');
    });
    line('inv20-06', () => {
      pointAt(() => section().find('.client-card__consent'), 1200);
      tap(() => section().find('.client-card__consent input'));
      section().find('.client-card__consent input').should('be.checked');
    });
    line('inv20-07', () => tap(() => section().contains('button', 'Save card')));
    offCamera(() => section().contains('New card saved. Nothing was charged.', { timeout: 90000 }).should('exist'));
    line('inv20-08', () => pointAt(() => section().contains('.client-card__card', 'Mastercard ending 4444'), 4500));
    offCamera(() => section().contains('.client-card__note', 'billed on a different card', { timeout: 60000 }).should('exist'));
    line('inv20-09', () => pointAt(() => section().contains('.client-card__note', 'billed on a different card'), 5000));
    line('inv20-10', () => tap(() => section().contains('button', 'Remove card')));
    line('inv20-11', () => pointAt(() => section().contains('.client-card__muted', 'Removes the card everywhere'), 5000));
    line('inv20-12', () => typeSlowly(() => section().find('.client-card__field input'), 'Owner asked us to remove it'));
    line('inv20-13', () => tap(() => section().find('.client-card__form').contains('button', 'Remove card')));
    offCamera(() => section().contains('No card on file', { timeout: 60000 }).should('exist'));
    line('inv20-14', () => pointAt(() => section().contains('.client-card__card', 'No card on file'), 4000));
    offCamera(() => {
      cy.visit(`/schedule/clients?clientId=${tom}&tab=financial`);
      section().contains('Expired, ending', { timeout: 60000 }).should('exist');
      section().scrollIntoView({ offset: { top: -160, left: 0 } });
      cy.wait(1000);
    });
    line('inv20-16', () => pointAt(() => section().find('.client-card__card'), 5000));
    // Biscuit's bill is made only now: with a bill open, the Financial tab hides Card on file.
    offCamera(() => {
      openVisit(biscuit, tom, 'Visit', 60).then(({ appt, enc }) => {
        chenVisit = appt;
        schedulingApi('cl', 'POST', '/visit-invoices', { practiceId: w.practiceId, appointmentId: appt, clientId: tom }).then(() => {
          setBillBranch(tom);
          catalogId('Office exam').then((c) =>
            schedulingApi('doctorA', 'POST', `/soap-encounters/${enc}/orders`, {
              practiceId: w.practiceId, name: 'Office exam', catalogItemId: c.id, catalogItemType: c.type, qty: 1, kind: 'treatment', state: 'accepted', unitPrice: 75,
            })
          );
        });
      });
      cy.then(() => cy.visit(`/schedule/soap/${chenVisit}/${biscuit}/checkout?clientId=${tom}`));
      cy.contains('.soap-checkout-actions button', 'Card on file', { timeout: 60000 }).should('be.disabled');
      cy.wait(1500);
    });
    line('inv20-17', () => pointAt(() => cy.contains('.soap-checkout-actions button', 'Card on file'), 5000));
    line('inv20-15');
    finish();
  });
});

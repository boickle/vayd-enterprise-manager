/// <reference types="cypress" />
/**
 * Training video, MEM-19: renewals, the 14-day notice and what the client can choose (docs/training/scripts/memberships/MEM-19-renewals.md).
 * TEST stack on Stripe TEST mode, demo names only. Maple's Canine Foundations (monthly) year ends in 7 days. The page
 * is opened from the link the renewal email carries (signed with the test stack's test-only secret).
 */
import '../support/e2e';
import { enrolPet, fileAgreement, pets, PLAN, renewalLink, resetMembershipWorld, settle, trace } from './memKit';
import { finish, line, loadNarration, offCamera, pointAt, startClock, tap } from './trainingKit';

describe('Training: MEM-19 renewals', () => {
  it('MEM-19', () => {
    const p = pets();
    loadNarration();
    trace('setup');
    resetMembershipWorld();
    enrolPet(p.maple, PLAN.dogFoundationsMonthly, { startDaysAgo: 358 }).then((id) => {
      fileAgreement(p.maple, p.maria, 358);
      renewalLink(id).then((path) => cy.visit(path));
    });
    cy.contains('h1', "Review Maple's membership", { timeout: 90000 }).should('be.visible');
    cy.wait(1500);

    trace('clock');
    startClock();
    trace('m19-01'); line('m19-01');
    trace('m19-02'); line('m19-02');
    trace('m19-03'); line('m19-03', () => pointAt(() => cy.contains('h1', "Review Maple's membership").parent(), 5000));
    trace('m19-04'); line('m19-04', () => pointAt(() => cy.get('.renewal-review__card'), 5000));
    // Owner review, Nov 10: say why renewing is worth it.
    trace('m19-04b'); line('m19-04b', () => pointAt(() => cy.get('.renewal-review__card'), 9000));
    trace('m19-05'); line('m19-05', () => {
      tap(() => cy.get('.renewal-review__change-plan'));
      cy.contains('h2', 'Choose a plan for next year').should('exist');
    });
    trace('m19-06'); line('m19-06', () => {
      pointAt(() => cy.contains('h2', 'Choose a plan for next year').next(), 4500);
      settle(() => cy.get('.renewal-review__interval-yearly'));
    });
    trace('m19-07'); line('m19-07', () => {
      tap(() => cy.get('.renewal-review__interval-yearly'));
      settle(() => cy.contains('.renewal-review__primary', 'Save my choice'));
    });
    trace('m19-08'); line('m19-08', () => {
      tap(() => cy.contains('.renewal-review__primary', 'Save my choice'));
    });
    offCamera(() => cy.contains('.renewal-review__stay', 'Saved.', { timeout: 60000 }).should('exist'));
    trace('m19-09'); line('m19-09', () => {
      settle(() => cy.contains('.renewal-review__stay', 'Saved.'));
      pointAt(() => cy.contains('.renewal-review__stay', 'Saved.'), 4000);
      settle(() => cy.get('.renewal-review__cancel-link'));
    });
    trace('m19-10'); line('m19-10', () => {
      tap(() => cy.get('.renewal-review__cancel-link'));
      cy.get('form.renewal-review__cancel').should('exist');
    });
    trace('m19-11'); line('m19-11', () => {
      settle(() => cy.get('form.renewal-review__cancel'));
      pointAt(() => cy.get('form.renewal-review__cancel'), 8000);
    });
    trace('m19-12'); line('m19-12');
    trace('done');
    finish();
  });
});

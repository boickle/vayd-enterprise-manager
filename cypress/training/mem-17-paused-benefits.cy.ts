/// <reference types="cypress" />
/**
 * Training video, MEM-17: paused benefits, failed payments and card disputes (docs/training/scripts/memberships/MEM-17-paused-benefits.md).
 * TEST stack on Stripe TEST mode, demo names only. Maple (Canine Foundations) has benefits paused for a past-due
 * payment; Juniper (Feline Foundations) for a card dispute. The pause is set the way Stripe's webhooks set it (the
 * test stack can't receive webhooks). Casey Morgan (CL) changes Maple's card; Robin Hale (manager) shows Resume.
 */
import '../support/e2e';
import { signInAsScheduling } from '../support/schedulingWorld';
import { stripeField } from './invKit';
import { chartUrl, enrolPet, fileAgreement, pets, PLAN, quietChart, resetMembershipWorld, settle, sql, trace } from './memKit';
import { finish, line, loadNarration, offCamera, pointAt, startClock, tap, typeSlowly } from './trainingKit';

describe('Training: MEM-17 paused benefits', () => {
  it('MEM-17', () => {
    const p = pets();
    loadNarration();
    trace('setup');
    resetMembershipWorld();
    enrolPet(p.maple, PLAN.dogFoundationsMonthly, { startDaysAgo: 75 }).then((id) => {
      sql(`UPDATE wellness_plans SET "benefitsPausedAt"=now() - interval '2 days', "benefitsPausedReason"='Membership payment past due' WHERE id=${id}`);
      // A real missed payment in Stripe test mode: the card declines and a $69 invoice stays open.
      sql(`SELECT "stripeSubscriptionId" FROM wellness_plans WHERE id=${id}`).then((sub) =>
        cy
          .exec(`bash cypress/training/setup/stripe-mem.sh pastdue "${String(Cypress.env('SCH_API_DIR'))}" ${String(sub).trim()} 69`, { timeout: 120000 })
          .its('stdout')
          .should('match', /^in_\S+ open/)
      );
    });
    fileAgreement(p.maple, p.maria, 75);
    enrolPet(p.juniper, PLAN.catFoundationsMonthly, { startDaysAgo: 75 }).then((id) =>
      sql(`UPDATE wellness_plans SET "benefitsPausedAt"=now() - interval '5 days', "benefitsPausedReason"='Card dispute' WHERE id=${id}`)
    );
    fileAgreement(p.juniper, p.maria, 75);
    signInAsScheduling('cl', chartUrl(p.maple));
    quietChart();
    cy.get('.pmp-paused', { timeout: 60000 }).should('exist');
    settle(() => cy.get('#pims-emr-membership'));
    cy.wait(1000);

    trace('clock');
    startClock();
    trace('m17-01'); line('m17-01');
    trace('m17-02'); line('m17-02');
    trace('m17-03'); line('m17-03', () => pointAt(() => cy.get('.pmp-head-paused'), 3500));
    trace('m17-04'); line('m17-04', () => {
      settle(() => cy.get('.pmp-paused'));
      pointAt(() => cy.get('.pmp-paused .pmp-paused__copy p').first(), 5500);
      settle(() => cy.contains('.mcu button', 'Change card'));
    });
    trace('m17-05'); line('m17-05', () => {
      tap(() => cy.contains('.mcu button', 'Change card'));
      cy.get('.mcu-edit iframe', { timeout: 60000 }).should('exist');
      cy.wait(1000);
    });
    trace('m17-06'); line('m17-06', () => {
      const host = '.mcu-edit';
      typeSlowly(() => cy.get(`${host} .pvms-field input`).first(), 'Maria Rivera');
      stripeField(host, 'cardnumber', '5555555555554444');
      stripeField(host, 'exp-date', '1230');
      stripeField(host, 'cvc', '123');
      stripeField(host, 'postal', '27606');
    });
    trace('m17-07'); line('m17-07', () => tap(() => cy.contains('.mcu-actions button', 'Use this card for the membership')));
    offCamera(() => cy.get('.mcu-ok', { timeout: 90000 }).should('exist'));
    trace('m17-08'); line('m17-08', () => pointAt(() => cy.get('.mcu-ok'), 6000));
    offCamera(() => {
      signInAsScheduling('manager', chartUrl(p.juniper));
      quietChart();
      cy.get('.pmp-paused button', { timeout: 60000 }).should('exist');
      settle(() => cy.get('.pmp-paused'));
      cy.wait(800);
    });
    trace('m17-09'); line('m17-09', () => pointAt(() => cy.get('.pmp-paused .pmp-paused__copy'), 6000));
    trace('m17-10'); line('m17-10', () => pointAt(() => cy.contains('.pmp-paused button', 'Resume benefits'), 5000));
    trace('m17-11'); line('m17-11');
    trace('done');
    finish();
  });
});

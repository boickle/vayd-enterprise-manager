/// <reference types="cypress" />
/**
 * Training video, MEM-02: enroll a pet at the visit (docs/training/scripts/memberships/MEM-02-enroll-at-the-visit.md).
 * TEST stack, demo names only. Juniper (cat, 6 y) has no plan; Maria signs on screen and Casey Morgan (client
 * liaison) enrols her on Feline Foundations monthly, then takes the $59 fee by card over the phone (Stripe's test
 * Visa; the card box loads from Stripe test mode).
 */
import '../support/e2e';
import { signInAsScheduling } from '../support/schedulingWorld';
import { stripeField } from './invKit';
import { chartUrl, drawSignature, pets, quietChart, resetMembershipWorld, settle, trace } from './memKit';
import { finish, line, loadNarration, offCamera, pointAt, startClock, tap, typeSlowly } from './trainingKit';

describe('Training: MEM-02 enroll at the visit', () => {
  it('MEM-02', () => {
    const p = pets();
    loadNarration();
    trace('setup');
    // Maria has no card on file in this story (she gives the card at the visit).
    resetMembershipWorld([`UPDATE clients SET "savedPaymentMethodId"=NULL, "stripeCustomerId"=NULL WHERE id=${p.maria}`]);
    trace('reset done');
    signInAsScheduling('cl', chartUrl(p.juniper));
    quietChart();
    cy.contains('button', 'Enroll in a plan', { timeout: 60000 }).should('be.visible');
    cy.wait(1500);

    const planRow = () => cy.contains('.pmp-plan', 'Membership - Feline Foundations - Monthly');
    trace('clock');
    startClock();
    trace('m02-01');
    line('m02-01');
    trace('m02-02');
    line('m02-02');
    trace('m02-03');
    line('m02-03', () => {
      tap(() => cy.contains('button', 'Enroll in a plan'));
      cy.get('.membership-waiver').should('exist');
    });
    trace('m02-04');
    line('m02-04', () => pointAt(() => cy.get('.membership-waiver h3'), 3500));
    trace('m02-05');
    line('m02-05', () => {
      pointAt(() => cy.get('.membership-waiver__scroll'), 2500);
      cy.get('.membership-waiver__scroll').scrollTo('center', { duration: 2500 });
    });
    trace('m02-06');
    line('m02-06', () => tap(() => cy.get('.membership-waiver__check input')));
    trace('m02-07');
    line('m02-07', () => drawSignature(() => cy.get('.membership-waiver__draw canvas')));
    trace('m02-08');
    line('m02-08', () => typeSlowly(() => cy.get('.membership-waiver__sign input'), 'Maria Rivera'));
    trace('m02-09'); line('m02-09', () => pointAt(() => cy.contains('.pmp-muted', 'Enrolling prices this visit'), 4500));
    trace('m02-10'); line('m02-10', () => {
      settle(() => cy.get('.pmp-enrol-card'));
      typeSlowly(() => cy.get('.pmp-enrol-card .pvms-field input').first(), 'Maria Rivera');
    });
    trace('m02-11'); line('m02-11', () => {
      stripeField('.pmp-enrol-card', 'cardnumber', '4242424242424242');
      stripeField('.pmp-enrol-card', 'exp-date', '1234');
      stripeField('.pmp-enrol-card', 'cvc', '123');
      stripeField('.pmp-enrol-card', 'postal', '27606');
      settle(planRow);
    });
    trace('m02-12'); line('m02-12', () => pointAt(planRow, 5000));
    trace('m02-13'); line('m02-13', () => tap(() => planRow().find('button')));
    trace('m02-14'); line('m02-14', () => pointAt(() => cy.contains('[role="dialog"], [role="alertdialog"]', 'Enroll in Membership - Feline Foundations - Monthly?'), 5000));
    trace('m02-15'); line('m02-15', () => tap(() => cy.contains('[role="dialog"] button, [role="alertdialog"] button', /^Enroll & charge/)));
    offCamera(() => {
      cy.get('.pmp-summary__fee-note', { timeout: 120000 }).should('contain', 'Benefits are available right away');
      settle(() => cy.get('.pmp-summary'));
      cy.wait(800);
    });
    trace('m02-16'); line('m02-16', () => pointAt(() => cy.get('.pmp-summary'), 6000));
    trace('m02-17'); line('m02-17');
    trace('done');
    finish();
  });
});

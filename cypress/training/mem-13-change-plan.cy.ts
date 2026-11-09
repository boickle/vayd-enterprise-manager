/// <reference types="cypress" />
/**
 * Training video, MEM-13: change a pet's plan (docs/training/scripts/memberships/MEM-13-change-plan.md).
 * TEST stack on Stripe TEST mode, demo names only. Maple (dog, 4 y) was put on Canine Golden monthly 10 days ago by
 * mistake (test subscription). Casey Morgan (client liaison) moves her to Canine Foundations monthly in the first month.
 */
import '../support/e2e';
import { signInAsScheduling } from '../support/schedulingWorld';
import { chartUrl, enrolPet, fileAgreement, pets, PLAN, PLAN_GOLDEN_DOG, quietChart, resetMembershipWorld, settle, trace } from './memKit';
import { finish, line, loadNarration, offCamera, pointAt, startClock, tap, typeSlowly } from './trainingKit';

describe('Training: MEM-13 change plan', () => {
  it('MEM-13', () => {
    const p = pets();
    loadNarration();
    trace('setup');
    resetMembershipWorld();
    enrolPet(p.maple, PLAN_GOLDEN_DOG, { startDaysAgo: 10 });
    fileAgreement(p.maple, p.maria, 10);
    signInAsScheduling('cl', chartUrl(p.maple));
    quietChart();
    cy.contains('.pmp-btn-change', 'Change plan', { timeout: 60000 }).should('not.be.disabled');
    settle(() => cy.get('.pmp-summary'));
    cy.wait(1000);

    const target = () => cy.contains('.pmp-plan', PLAN.dogFoundationsMonthly);
    trace('clock');
    startClock();
    trace('m13-01'); line('m13-01');
    trace('m13-02'); line('m13-02');
    trace('m13-03'); line('m13-03', () => pointAt(() => cy.get('.pmp-summary__head'), 4500));
    trace('m13-04'); line('m13-04', () => {
      tap(() => cy.contains('.pmp-btn-change', 'Change plan'));
      cy.contains('Change this pet’s plan').should('exist');
    });
    trace('m13-05'); line('m13-05', () => {
      settle(() => cy.get('.pmp-change__opts'));
      pointAt(() => cy.get('.pmp-change__opts .pmp-check').first(), 5000);
    });
    trace('m13-06'); line('m13-06', () => {
      typeSlowly(() => cy.get('.pmp-change__opts input.pmp-input'), 'Signed up on the wrong plan');
      settle(target);
    });
    trace('m13-07'); line('m13-07', () => {
      tap(() => target().contains('button', 'Move to this plan'));
      cy.get('[role="dialog"], [role="alertdialog"]').should('exist');
    });
    trace('m13-08'); line('m13-08', () => pointAt(() => cy.contains('[role="dialog"], [role="alertdialog"]', 'Move to').first(), 7000));
    trace('m13-09'); line('m13-09', () => tap(() => cy.contains('[role="dialog"] button, [role="alertdialog"] button', /^Move to /)));
    offCamera(() => cy.contains('[role="dialog"], [role="alertdialog"]', 'Plan changed', { timeout: 60000 }).should('exist'));
    trace('m13-09b'); line('m13-09b', () => pointAt(() => cy.contains('[role="dialog"], [role="alertdialog"]', 'Plan changed'), 7000));
    trace('m13-09c'); line('m13-09c', () => {
      tap(() => cy.contains('[role="dialog"] button, [role="alertdialog"] button', /^OK$/));
      cy.contains('.pmp-summary__plan', 'Canine Foundations', { timeout: 60000 }).should('exist');
    });
    trace('m13-10'); line('m13-10', () => {
      settle(() => cy.get('.pmp-summary'));
      pointAt(() => cy.get('.pmp-summary'), 4000);
      settle(() => cy.get('.pmp-audit__toggle'));
    });
    trace('m13-11'); line('m13-11', () => {
      tap(() => cy.get('.pmp-audit__toggle'));
      cy.get('.pmp-audit__list').should('exist');
    });
    trace('m13-12'); line('m13-12');
    trace('done');
    finish();
  });
});

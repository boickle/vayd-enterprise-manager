/// <reference types="cypress" />
/**
 * Training video, MEM-15: when a pet passes (docs/training/scripts/memberships/MEM-15-when-a-pet-passes.md).
 * TEST stack on Stripe TEST mode, demo names only. Pepper (dog, 10 y) is on Canine Golden monthly (test subscription,
 * one $99 invoice paid, nothing used). Casey Morgan (client liaison) inactivates him from the chart.
 */
import '../support/e2e';
import { signInAsScheduling } from '../support/schedulingWorld';
import { chartUrl, enrolPet, fileAgreement, pets, PLAN_GOLDEN_DOG, quietChart, resetMembershipWorld, settle, trace } from './memKit';
import { choose, finish, line, loadNarration, offCamera, pointAt, startClock, tap } from './trainingKit';

describe('Training: MEM-15 when a pet passes', () => {
  it('MEM-15', () => {
    const p = pets();
    loadNarration();
    trace('setup');
    resetMembershipWorld();
    enrolPet(p.pepper, PLAN_GOLDEN_DOG, { startDaysAgo: 90 });
    fileAgreement(p.pepper, p.maria, 90);
    signInAsScheduling('cl', chartUrl(p.pepper, false));
    quietChart();
    cy.contains('button', 'Deactivate', { timeout: 60000 }).should('be.visible');
    cy.window().then((win) => win.scrollTo(0, 0));
    cy.wait(1500);

    const modal = () => cy.get('.death-wrapup-modal');
    const section = (t: string) => cy.contains('.death-wrapup-section', t);
    trace('clock');
    startClock();
    trace('m15-01'); line('m15-01');
    trace('m15-02'); line('m15-02');
    trace('m15-03'); line('m15-03', () => {
      tap(() => cy.contains('button', 'Deactivate'));
      modal().should('exist');
      cy.contains('.death-wrapup-section', 'memberships', { timeout: 60000 }).should('exist');
    });
    trace('m15-04'); line('m15-04', () => pointAt(() => cy.get('.death-wrapup-lead'), 3500));
    trace('m15-05'); line('m15-05', () => choose(() => cy.get('.death-wrapup-reason select'), 'Passed away'));
    trace('m15-06'); line('m15-06', () => pointAt(() => section('memberships'), 6000));
    trace('m15-07'); line('m15-07', () => {
      settle(() => section('Appointments'));
      pointAt(() => section('Appointments'), 4000);
    });
    trace('m15-08'); line('m15-08', () => tap(() => cy.contains('.death-wrapup-actions button', 'Accept and inactivate')));
    offCamera(() => {
      modal().should('not.exist', { timeout: 120000 });
      cy.reload();
      cy.get('#pims-emr-membership', { timeout: 60000 }).should('exist');
      cy.window().then((win) => win.scrollTo(0, 0));
      cy.wait(1500);
    });
    trace('m15-09'); line('m15-09', () => pointAt(() => cy.contains('Inactive patient', { matchCase: false }).parent(), 5000));
    trace('m15-10'); line('m15-10');
    trace('done');
    finish();
  });
});

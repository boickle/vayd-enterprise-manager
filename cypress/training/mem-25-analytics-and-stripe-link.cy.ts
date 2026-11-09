/// <reference types="cypress" />
/**
 * Training video, MEM-25: membership analytics, and linking a Stripe subscription by hand
 * (docs/training/scripts/memberships/MEM-25-analytics-and-stripe-link.md). TEST stack on Stripe TEST mode, demo
 * names only. Four memberships across both households so the analytics have something to show. Juniper's membership
 * has no Stripe link; a matching Stripe test subscription exists for Maria, and Robin Hale pastes its id into Link.
 */
import '../support/e2e';
import { signInAsScheduling } from '../support/schedulingWorld';
import { chartUrl, enrolPet, fileAgreement, pets, PLAN, PLAN_GOLDEN_DOG, quietChart, resetMembershipWorld, settle, testSubscription, trace } from './memKit';
import { finish, line, loadNarration, offCamera, pointAt, startClock, tap, typeSlowly } from './trainingKit';

describe('Training: MEM-25 analytics and Stripe link', () => {
  it('MEM-25', () => {
    const p = pets();
    let sub = '';
    loadNarration();
    trace('setup');
    resetMembershipWorld();
    enrolPet(p.maple, PLAN.dogFoundationsMonthly, { startDaysAgo: 200 });
    enrolPet(p.biscuit, PLAN.dogFoundationsMonthly, { startDaysAgo: 90, clientId: p.tom });
    enrolPet(p.pepper, PLAN_GOLDEN_DOG, { startDaysAgo: 40 });
    enrolPet(p.juniper, PLAN.catFoundationsMonthly, { startDaysAgo: 12, subscription: null });
    fileAgreement(p.juniper, p.maria, 12);
    testSubscription(p.maria, PLAN.catFoundationsMonthly).then((s) => {
      sub = s.subscription;
    });
    trace('members set up');
    signInAsScheduling('manager', '/schedule/analytics');
    cy.contains('a, button', /^Memberships$/, { timeout: 90000 }).click();
    cy.contains('Total memberships', { timeout: 90000 }).should('exist');
    cy.wait(2500);

    const card = (title: string) => cy.contains('.MuiCardHeader-title, .MuiTypography-root', title).closest('.MuiCard-root');
    trace('clock');
    startClock();
    trace('m25-01'); line('m25-01');
    trace('m25-02'); line('m25-02');
    trace('m25-03'); line('m25-03', () => {
      pointAt(() => card('Total memberships'), 2000);
      pointAt(() => card('Client households with a member'), 2000);
      settle(() => card('Memberships by type'));
      pointAt(() => card('Memberships by type'), 2500);
    });
    trace('m25-04'); line('m25-04', () => {
      settle(() => card('Channel'));
      pointAt(() => card('Channel'), 4000);
    });
    trace('m25-05'); line('m25-05', () => {
      settle(() => card('Sign-up card conversion'));
      pointAt(() => card('Sign-up card conversion'), 4500);
    });
    trace('m25-06'); line('m25-06', () => {
      const chart = () => cy.contains('h6', 'Memberships over time').parent().parent();
      settle(chart);
      pointAt(chart, 4000);
    });
    offCamera(() => {
      cy.visit(chartUrl(p.juniper));
      quietChart();
      cy.contains('button.pmp-link-btn', 'Link', { timeout: 60000 }).should('be.visible');
      settle(() => cy.contains('button.pmp-link-btn', 'Link').parent());
      cy.wait(1000);
    });
    trace('m25-07'); line('m25-07', () => pointAt(() => cy.contains('button.pmp-link-btn', 'Link').parent(), 4500));
    trace('m25-08'); line('m25-08', () => {
      tap(() => cy.contains('button.pmp-link-btn', 'Link'));
      cy.contains('[role="dialog"], [role="alertdialog"]', 'Link Stripe subscription').should('be.visible');
    });
    trace('m25-09'); line('m25-09', () => pointAt(() => cy.contains('[role="dialog"], [role="alertdialog"]', 'starts with sub_'), 4000));
    trace('m25-10'); line('m25-10', () => cy.then(() => typeSlowly(() => cy.get('[role="dialog"], [role="alertdialog"]').find('input, textarea').first(), sub)));
    trace('m25-11'); line('m25-11', () => {
      tap(() => cy.get('[role="dialog"], [role="alertdialog"]').contains('button', /^Link$/));
      cy.contains('Not linked', { timeout: 60000 }).should('not.exist');
      cy.wait(1000);
    });
    trace('m25-12'); line('m25-12', () => pointAt(() => cy.contains('a', '↗').parent(), 3500));
    trace('m25-13'); line('m25-13');
    trace('done');
    finish();
  });
});

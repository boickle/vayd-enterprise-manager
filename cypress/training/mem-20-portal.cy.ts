/// <reference types="cypress" />
/**
 * Training video, MEM-20: what members see in the portal (docs/training/scripts/memberships/MEM-20-portal.md).
 * TEST stack on Stripe TEST mode, demo names only. Maria's portal login. Maple on Canine Foundations for 355 days
 * (renews in 10 days, so the renewal banner shows), four benefits used. Juniper not a member, with a paid visit today
 * (post-visit signup banner).
 */
import '../support/e2e';
import { signInAsScheduling } from '../support/schedulingWorld';
import { enrolPet, fileAgreement, paidVisit, pets, PLAN, resetMembershipWorld, settle, trace, useBenefits } from './memKit';
import { finish, line, loadNarration, offCamera, pointAt, startClock, tap } from './trainingKit';

describe('Training: MEM-20 portal', () => {
  it('MEM-20', () => {
    const p = pets();
    loadNarration();
    trace('setup');
    resetMembershipWorld();
    enrolPet(p.maple, PLAN.dogFoundationsMonthly, { startDaysAgo: 355 }).then((id) =>
      useBenefits(id, [
        { name: 'Annual Wellness Visit', daysAgo: 300 },
        { name: 'Rabies Vaccine - 3 year', daysAgo: 300 },
        { name: 'DAPP (Distemper) Vaccine - 3 year', daysAgo: 300 },
        { name: 'Heartworm / Tick Test (4dx)', daysAgo: 300 },
      ])
    );
    fileAgreement(p.maple, p.maria, 355);
    paidVisit(p.juniper, p.maria, ['Annual Wellness Visit', 'Trip Fee', 'FVRCP (Distemper) Vaccine - 3 year']);
    trace('visit paid');
    signInAsScheduling('client', '/client-portal');
    cy.get('.pp-switcher', { timeout: 60000 }).should('be.visible');
    cy.get('.pp-switcher').contains('.pp-switch', 'Maple').then(($b) => {
      if ($b.attr('aria-pressed') !== 'true') cy.wrap($b).click();
    });
    cy.contains('.pp-member-plan-name', /Foundations/, { timeout: 60000 }).should('exist');
    cy.get('.pp-pv-banner', { timeout: 60000 }).should('exist');
    cy.get('.pp-renewal-banner', { timeout: 60000 }).should('exist');
    cy.wait(1500);

    const memberCard = () => cy.get('section[aria-label="Membership"]');
    const modal = () => cy.get('.pp-modal');
    trace('clock');
    startClock();
    trace('m20-01'); line('m20-01');
    trace('m20-02'); line('m20-02');
    trace('m20-03'); line('m20-03', () => pointAt(() => cy.get('.pp-switcher').contains('.pp-switch', 'Maple'), 2500));
    trace('m20-03b'); line('m20-03b', () => {
      settle(memberCard);
      pointAt(memberCard, 4000);
    });
    trace('m20-04'); line('m20-04', () => {
      tap(() => memberCard().contains('button', 'included'));
      cy.get('.pp-benefit-summary', { timeout: 60000 }).should('be.visible');
      cy.wait(800);
    });
    trace('m20-05'); line('m20-05', () => pointAt(() => cy.get('.pp-benefit-summary'), 4000));
    trace('m20-05b'); line('m20-05b', () => {
      settle(() => cy.get('.pp-benefit-group').first());
      pointAt(() => cy.get('.pp-benefit-group').first(), 4500);
    });
    trace('m20-06'); line('m20-06', () => {
      const perks = () => cy.contains('.pp-benefit-group h3', 'Always-on perks').closest('.pp-benefit-group');
      settle(perks);
      pointAt(perks, 4000);
    });
    trace('m20-06b'); line('m20-06b', () => {
      const cardUpd = () => cy.contains('.pp-benefit-group h3', 'Always-on perks').closest('.pp-benefit-group').next('.pp-benefit-group');
      settle(cardUpd);
      pointAt(cardUpd, 3500);
    });
    trace('m20-07'); line('m20-07', () => {
      tap(() => modal().contains('button', 'Close'));
      cy.get('.pp-modal').should('not.exist');
    });
    trace('m20-08'); line('m20-08', () => {
      settle(() => cy.get('.pp-renewal-banner').first());
      pointAt(() => cy.get('.pp-renewal-banner').first(), 5000);
    });
    trace('m20-09'); line('m20-09', () => tap(() => cy.get('.pp-switcher').contains('.pp-switch', 'Juniper')));
    trace('m20-10'); line('m20-10', () => {
      settle(() => cy.get('.pp-pv-banner'));
      pointAt(() => cy.get('.pp-pv-banner'), 5500);
      settle(() => cy.contains('button', 'See my membership savings'));
    });
    trace('m20-11'); line('m20-11', () => {
      const sv = () => cy.contains('button', 'See my membership savings');
      tap(sv);
      cy.contains('h1', 'Your One-Team Membership savings', { timeout: 60000 }).should('be.visible');
    });
    offCamera(() => cy.contains('Loading your savings').should('not.exist'));
    trace('m20-12'); line('m20-12', () => {
      pointAt(() => cy.contains('h1', 'Your One-Team Membership savings').parent(), 4000);
      // P-20 (fixed Nov 10): today's paid Scout visit now gives Juniper a real comparison.
      settle(() => cy.get('[id^="pet-savings-"]').filter(':contains("Juniper")').find('table'));
    });
    trace('m20-12b'); line('m20-12b', () => pointAt(() => cy.get('[id^="pet-savings-"]').filter(':contains("Juniper")').find('table'), 5500));
    trace('m20-13'); line('m20-13');
    trace('done');
    finish();
  });
});

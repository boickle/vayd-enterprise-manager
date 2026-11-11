/// <reference types="cypress" />
/**
 * Training video ROLE-07: What an Executive (read-only) sees (docs/training/scripts/permissions/ROLE-07-executive.md).
 * TEST stack only. Signed in as Blair Stone (Executive (read-only)). Nothing is changed.
 */
import '../support/e2e';
import { analyticsLink, pointAtSteady, reportCategories, reportRow, schWorld, startAs, topBar, topLinks, draftCampaign } from './permRecord';
import { finish, line, loadNarration, offCamera, pointAt, startClock, tap } from './trainingKit';

const menuLink = (label: string) =>
  cy.get('a, button').filter((_, el) => (el as HTMLElement).innerText.trim() === label && !!(el as HTMLElement).offsetParent).first();
const quickActions = () => cy.contains(/^QUICK ACTIONS$/i).parent();

describe('Training: ROLE-07 executive', () => {
  it('ROLE-07', () => {
    loadNarration();
    draftCampaign();
    startAs('executive', '/schedule', () => topBar('Marketing').should('exist'));

    const record = () => {
      startClock();
      line('r07-01');
      line('r07-02');
      line('r07-03', () => pointAt(() => topLinks(), 4500));
      line('r07-04', () => pointAtSteady(() => quickActions(), 3500));
      line('r07-05', () => {
        tap(() => analyticsLink());
        reportCategories().should('exist');
      });
      line('r07-06', () => pointAtSteady(() => reportCategories(), 2500));
      line('r07-07', () => pointAtSteady(() => reportRow(), 2000));
      line('r07-08', () => {
        tap(() => topBar('Marketing'));
        menuLink('Email campaigns').should('exist');
      });
      line('r07-09', () => pointAtSteady(() => menuLink('Promotions'), 1800));
      line('r07-10', () => {
        tap(() => menuLink('Email campaigns'));
        cy.location('pathname', { timeout: 30000 }).should('match', /marketing/i);
        cy.wait(1500);
      });
      line('r07-11', () => pointAtSteady(() => cy.contains(/Marketing emails to clients/).parent().parent(), 3500));
      offCamera(() => {
        cy.visit(`/schedule/clients?clientId=${schWorld().households.B.clientId}`);
        cy.contains(/Tom Chen/, { timeout: 60000 }).should('exist');
        cy.wait(1500);
      });
      line('r07-12', () => pointAtSteady(() => cy.contains(/Tom Chen/).first(), 4000));
      line('r07-13');
      line('r07-14');
      line('r07-15');
      finish();
    };
    cy.then(() => record());
  });
});

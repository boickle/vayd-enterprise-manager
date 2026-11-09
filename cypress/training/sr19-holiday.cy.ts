/// <reference types="cypress" />
/**
 * Training video SR-19: Close the practice for a holiday
 * (docs/training/scripts/scheduling-routing/SR-19-close-for-a-holiday.md).
 * TEST stack only. No closed days at the start. Robin Hale (practice manager) adds Thu, Nov 26, 2026.
 */
import '../support/e2e';
import { schedulingWorld, signInAsScheduling } from '../support/schedulingWorld';
import { hideNonProdBanner } from './srRecord';
import { finish, line, loadNarration, pointAt, startClock, tap } from './trainingKit';

describe('Training: SR-19 close for a holiday', () => {
  it('SR-19', () => {
    const w = schedulingWorld();
    loadNarration();
    hideNonProdBanner();
    const db = String(Cypress.env('SCH_DB'));
    expect(db).to.match(/^vayd_api_test[A-Za-z0-9_]*$/);
    cy.exec(`psql -d ${db} -c "delete from practice_settings where key='scheduling.closedDates' and \\"practiceId\\"=${w.practiceId}"`);
    cy.exec(`redis-cli -n ${Cypress.env('SCH_REDIS_DB') || 10} --scan --pattern '*setting*' | xargs -n 50 redis-cli -n ${Cypress.env('SCH_REDIS_DB') || 10} del`, { failOnNonZeroExit: false });
    Cypress.config('scrollBehavior', 'center');
    signInAsScheduling('manager', '/schedule/home');
    cy.get('header a, header button', { timeout: 60000 }).filter(':visible').filter((_, el) => el.innerText.trim() === 'Settings').should('exist');
    cy.wait(1500);

    const box = () => cy.contains('strong', /^Closed days$/).parents('.settings-premeds-window').first();
    const record = () => {
      startClock();
      line('sr19-01');
      line('sr19-02', () => {
        tap(() => cy.get('header a, header button').filter(':visible').filter((_, el) => el.innerText.trim() === 'Settings').first());
        cy.contains('strong', /^Closed days$/, { timeout: 60000 }).scrollIntoView();
        cy.contains('No closed days.', { timeout: 30000 }).should('exist');
        pointAt(() => box(), 2500);
      });
      line('sr19-03');
      line('sr19-04', () => pointAt(() => cy.contains(/Online booking offers no times on these dates/), 4000));
      line('sr19-05', () => {
        pointAt(() => cy.get('input[aria-label="Closed day to add"]'), 1500);
        cy.get('input[aria-label="Closed day to add"]').type('2026-11-26');
      });
      line('sr19-06', () => {
        tap(() => cy.contains('button', /^Add closed day$/));
        cy.contains(/closed for online booking\./, { timeout: 30000 }).should('exist');
      });
      line('sr19-07', () => {
        pointAt(() => cy.contains(/closed for online booking\./).first(), 2000);
        tap(() => box().find('summary').first());
        pointAt(() => box().contains('button', /^Remove$/), 2500);
      });
      line('sr19-08');
      line('sr19-09');
      finish();
    };
    cy.then(() => record());
  });
});

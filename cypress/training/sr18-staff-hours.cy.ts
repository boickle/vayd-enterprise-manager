/// <reference types="cypress" />
/**
 * Training video SR-18: Staff hours, zones and days off
 * (docs/training/scripts/scheduling-routing/SR-18-staff-hours-and-overrides.md).
 * TEST stack only. Signed in with an admin token minted for the training world (world.auth.admin). Nothing is saved:
 * Save schedule and the override day are pointed at, not used.
 */
import '../support/e2e';
import { signInAsScheduling } from '../support/schedulingWorld';
import { hideNonProdBanner } from './srRecord';
import { finish, line, loadNarration, pointAt, startClock, tap } from './trainingKit';

const staffPicker = () =>
  cy.get('select').filter((_, el) => Array.from((el as HTMLSelectElement).options).some((o) => /Avery Lane · Provider/.test(o.text))).first();

describe('Training: SR-18 staff hours', () => {
  it('SR-18', () => {
    loadNarration();
    hideNonProdBanner();
    Cypress.config('scrollBehavior', 'center');
    signInAsScheduling('admin' as any, '/settings');
    cy.contains('button', /^Staff$/, { timeout: 60000 }).first().click();
    cy.wait(800);
    cy.get('button').filter((_, el) => el.innerText.trim() === 'Staff').last().click();
    cy.contains(/Choose a person, then use the tabs/, { timeout: 60000 }).should('exist');
    cy.wait(1500);

    const record = () => {
      startClock();
      line('sr18-01');
      line('sr18-02', () => pointAt(() => cy.contains(/Choose a person, then use the tabs/), 3500));
      line('sr18-03');
      line('sr18-04', () => {
        pointAt(() => staffPicker(), 1200);
        staffPicker().then(($s) => {
          const opt = Array.from(($s[0] as HTMLSelectElement).options).find((o) => /Avery Lane · Provider/.test(o.text))!;
          cy.wrap($s).select(opt.value);
        });
        cy.contains('button', /^Schedule$/, { timeout: 30000 }).should('exist');
      });
      line('sr18-05', () => {
        tap(() => cy.contains('button', /^Schedule$/));
        cy.contains('Weekly schedule', { timeout: 30000 }).should('exist');
      });
      line('sr18-06', () => {
        pointAt(() => cy.contains('Weekly schedule').parent(), 3500);
        pointAt(() => cy.contains(/Off days are ignored by routing/), 2500);
      });
      line('sr18-07', () => {
        pointAt(() => cy.contains('button', /^Use every day$/).first(), 2500);
        pointAt(() => cy.contains('button', /^Save schedule$/), 2000);
      });
      line('sr18-08', () => {
        tap(() => cy.contains('button', /Date overrides/));
        cy.contains(/Schedule overrides by day/, { timeout: 30000 }).should('exist');
        pointAt(() => cy.contains(/Employee \(doctor\)/).parent(), 3500);
      });
      line('sr18-09');
      line('sr18-10');
      finish();
    };
    cy.then(() => record());
  });
});

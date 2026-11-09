/// <reference types="cypress" />
/**
 * Training video SR-07: What the family sees when they book online
 * (docs/training/scripts/scheduling-routing/SR-07-what-the-family-sees-online.md).
 * TEST stack only. Maria Rivera (client portal) asks for a visit for Maple without picking a time; the liaison
 * and client emails go to the capture file.
 */
import '../support/e2e';
import { schedulingWorld, signInAsScheduling } from '../support/schedulingWorld';
import { resetDemo } from './probes-sr/srKit';
import { hideNonProdBanner } from './srRecord';
import { finish, line, loadNarration, pointAt, startClock, tap, typeSlowly } from './trainingKit';

describe('Training: SR-07 what the family sees online', () => {
  it('SR-07', () => {
    const w = schedulingWorld();
    loadNarration();
    hideNonProdBanner();
    resetDemo();
    const db = String(Cypress.env('SCH_DB'));
    expect(db).to.match(/^vayd_api_test[A-Za-z0-9_]*$/);
    cy.exec(
      `psql -d ${db} -c "delete from appointment_request_submission where \\"requestData\\"->>'clientId' in ('${w.households.A.clientId}','${w.households.B.clientId}')"`
    );
    // The public form allows 3 submissions an hour per address. Clear those counters in this stack's own
    // Redis db (test stack only), so earlier takes don't block this one.
    cy.exec(`redis-cli -n ${Cypress.env('SCH_REDIS_DB') || 10} --scan --pattern 'throttle:*' | xargs -n 50 redis-cli -n ${Cypress.env('SCH_REDIS_DB') || 10} del`, { failOnNonZeroExit: false });
    Cypress.config('scrollBehavior', 'center');
    cy.intercept('GET', '**/public/species-breeds?practiceId=1', { fixture: 'species-breeds.json' });
    cy.intercept('GET', '**/public/species-breeds?practiceId=1&speciesId=*', { fixture: 'breeds.json' });
    cy.intercept('POST', '**/public/appointments/form').as('submit');
    signInAsScheduling('client', '/client-portal/request-appointment');
    cy.get('input[type="tel"]', { timeout: 30000 }).should('not.have.value', '');
    cy.wait(2000);

    const maple = () => cy.contains('[data-pet-id]', 'Maple');
    const record = () => {
      startClock();
      line('sr07-01');
      line('sr07-02', () => pointAt(() => cy.get('input[type="tel"]').first(), 3500));
      line('sr07-03');
      line('sr07-04', () => {
        tap(() => cy.contains('Is this the place we are doing the visit?').parent().find('input[value="Yes"]'));
        tap(() => cy.contains('Is your mailing address the same as this location?').parent().find('input[type="radio"]').first());
      });
      line('sr07-05', () => {
        tap(() => maple().find('input[type="checkbox"]').first());
        tap(() => maple().find('[data-visit-reason="not-feeling-well"]'));
        typeSlowly(() => cy.get('textarea').first(), 'Limping on the left hind leg since yesterday');
      });
      line('sr07-06', () => {
        pointAt(() => cy.contains('How soon do you need to be seen?').parent(), 2500);
        tap(() => cy.get('[data-how-soon="Flexible"]'));
        cy.contains('Checking online scheduling options', { timeout: 40000 }).should('not.exist');
      });
      line('sr07-07', () =>
        pointAt(() => cy.contains('h2', 'Pick a Date').closest('[role="region"]'), 6000)
      );
      line('sr07-08', () =>
        typeSlowly(() => cy.get('[data-form-field="schedulingNotes"] textarea').first(), 'Mornings are best, not Wednesdays')
      );
      line('sr07-09', () => {
        tap(() => cy.contains('button', /^Submit$/));
        cy.wait('@submit', { timeout: 90000 });
        cy.contains('We are working on booking your appointment', { timeout: 30000 }).should('be.visible');
      });
      line('sr07-10', () => {
        pointAt(() => cy.contains('We are working on booking your appointment'), 3000);
        pointAt(() => cy.contains('Review & Join Membership Now'), 2500);
      });
      line('sr07-11');
      line('sr07-12');
      finish();
    };
    cy.then(() => record());
  });
});

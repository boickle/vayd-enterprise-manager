/// <reference types="cypress" />
/** Check the B6 and closed-days fixes on the test stack. */
import '../../support/e2e';
import { signInAsScheduling } from '../../support/schedulingWorld';
import { dump, resetDemo } from './srKit';
describe('fix check', () => {
  it('B6: Maria is offered online times', () => {
    Cypress.config('scrollBehavior', 'center');
    resetDemo();
    cy.intercept('GET', '**/public/species-breeds?practiceId=1', { fixture: 'species-breeds.json' });
    cy.intercept('GET', '**/public/species-breeds?practiceId=1&speciesId=*', { fixture: 'breeds.json' });
    signInAsScheduling('client', '/client-portal/request-appointment');
    cy.get('input[type="tel"]', { timeout: 30000 }).should('not.have.value', '');
    cy.contains('Is this the place we are doing the visit?').parent().find('input[value="Yes"]').check();
    cy.contains('Is your mailing address the same as this location?').parent().find('input[type="radio"]').first().check();
    cy.contains('[data-pet-id]', 'Maple').find('input[type="checkbox"]').first().check();
    cy.contains('[data-pet-id]', 'Maple').find('[data-visit-reason="not-feeling-well"]').click();
    cy.get('textarea').first().type('Limping on the left hind leg since yesterday');
    cy.get('[data-how-soon="Flexible"]').click();
    cy.contains('Checking online scheduling options', { timeout: 40000 }).should('not.exist');
    cy.wait(6000);
    dump('fix-b6-form', 'body');
    cy.screenshot('fix-b6-form', { capture: 'viewport' });
  });
  it('Closed days for a practice manager (not admin)', () => {
    signInAsScheduling('manager', '/schedule/settings');
    cy.wait(5000);
    dump('fix-closed-manager', 'body');
    cy.get('input[aria-label="Closed day to add"]').type('2026-11-26');
    cy.contains('button', 'Add closed day').click();
    cy.wait(2500);
    dump('fix-closed-added', 'body');
    cy.screenshot('fix-closed-added', { capture: 'viewport' });
  });
});

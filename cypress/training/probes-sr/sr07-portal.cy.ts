/// <reference types="cypress" />
/** Probe for SR-07: Maria requests a visit online (real availability on the test stack). */
import '../../support/e2e';
import { signInAsScheduling } from '../../support/schedulingWorld';
import { dump, resetDemo } from './srKit';

describe('SR-07 online request', () => {
  it('Maple', () => {
    Cypress.config('scrollBehavior', 'center');
    resetDemo();
    cy.intercept('GET', '**/public/species-breeds?practiceId=1', { fixture: 'species-breeds.json' });
    cy.intercept('GET', '**/public/species-breeds?practiceId=1&speciesId=*', { fixture: 'breeds.json' });
    signInAsScheduling('client', '/client-portal/request-appointment');
    cy.get('input[type="tel"]', { timeout: 30000 }).should('not.have.value', '');
    cy.wait(1500);
    dump('sr07-step1', 'body');
    cy.screenshot('sr07-step1', { capture: 'viewport' });
    cy.contains('Is this the place we are doing the visit?').parent().find('input[value="Yes"]').check();
    cy.contains('Is your mailing address the same as this location?').parent().find('input[type="radio"]').first().check();
    cy.contains('[data-pet-id]', 'Maple').find('input[type="checkbox"]').first().check();
    cy.contains('[data-pet-id]', 'Maple').find('[data-visit-reason="not-feeling-well"]').click();
    cy.get('textarea').first().type('Limping on the left hind leg since yesterday');
    cy.contains('How soon do you need to be seen?').scrollIntoView();
    cy.get('[data-how-soon="Flexible"]').click();
    cy.contains('Checking online scheduling options', { timeout: 40000 }).should('not.exist');
    cy.wait(2000);
    dump('sr07-howsoon-Maple', 'body');
    cy.screenshot('sr07-howsoon-Maple', { capture: 'viewport' });
  });
  it('Juniper', () => {
    Cypress.config('scrollBehavior', 'center');
    resetDemo();
    cy.intercept('GET', '**/public/species-breeds?practiceId=1', { fixture: 'species-breeds.json' });
    cy.intercept('GET', '**/public/species-breeds?practiceId=1&speciesId=*', { fixture: 'breeds.json' });
    signInAsScheduling('client', '/client-portal/request-appointment');
    cy.get('input[type="tel"]', { timeout: 30000 }).should('not.have.value', '');
    cy.wait(1500);
    dump('sr07-pets-Juniper', '[data-pet-id]');
    cy.contains('Is this the place we are doing the visit?').parent().find('input[value="Yes"]').check();
    cy.contains('Is your mailing address the same as this location?').parent().find('input[type="radio"]').first().check();
    cy.contains('[data-pet-id]', 'Juniper').find('input[type="checkbox"]').first().check();
    cy.contains('[data-pet-id]', 'Juniper').find('[data-visit-reason="not-feeling-well"]').click();
    cy.get('textarea').first().type('Limping on the left hind leg since yesterday');
    cy.contains('How soon do you need to be seen?').scrollIntoView();
    cy.get('[data-how-soon="Flexible"]').click();
    cy.contains('Checking online scheduling options', { timeout: 40000 }).should('not.exist');
    cy.wait(2000);
    dump('sr07-howsoon-Juniper', 'body');
    cy.screenshot('sr07-howsoon-Juniper', { capture: 'viewport' });
  });
});

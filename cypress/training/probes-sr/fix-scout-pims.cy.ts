/// <reference types="cypress" />
/** Check: a doctor whose only id is a Scout one (scout-<id>) gets routing results and online times. */
import '../../support/e2e';
import { includeSeededDoctorsInProviderList, signInAsScheduling } from '../../support/schedulingWorld';
import { dump, resetDemo } from './srKit';
describe('scout pimsId doctor', () => {
  it('Get Best Route finds Dr. Lane', () => {
    resetDemo();
    includeSeededDoctorsInProviderList();
    signInAsScheduling('cl', '/schedule/routing');
    cy.get('input[placeholder="Type doctor name..."]', { timeout: 30000 }).type('Lane');
    cy.contains('button, li, [role="option"]', 'Avery Lane').click({ force: true });
    cy.get('select').filter(':visible').filter((_, el) => (el as HTMLSelectElement).options[0]?.text === 'Select type…').first().select('Recheck');
    cy.get('input[placeholder="Type last name..."]').type('Chen');
    cy.contains('button', 'Chen, Tom').click();
    cy.contains('button', /^Biscuit$/).click();
    cy.wait(1500);
    cy.contains('button', /^Get Best Route$/).last().click();
    cy.wait(2000);
    cy.get('body').then(($b) => { if ($b.find('button:contains("Search anyway")').length) cy.contains('button', 'Search anyway').click(); });
    cy.contains('button', 'View Placement', { timeout: 40000 });
    cy.wait(3000);
    dump('scoutpims-results', 'body');
  });
  it('Maria is offered online times with Dr. Lane', () => {
    Cypress.config('scrollBehavior', 'center');
    cy.intercept('GET', '**/public/species-breeds?practiceId=1', { fixture: 'species-breeds.json' });
    cy.intercept('GET', '**/public/species-breeds?practiceId=1&speciesId=*', { fixture: 'breeds.json' });
    signInAsScheduling('client', '/client-portal/request-appointment');
    cy.get('input[type="tel"]', { timeout: 30000 }).should('not.have.value', '');
    cy.contains('Is this the place we are doing the visit?').parent().find('input[value="Yes"]').check();
    cy.contains('Is your mailing address the same as this location?').parent().find('input[type="radio"]').first().check();
    cy.contains('[data-pet-id]', 'Maple').find('input[type="checkbox"]').first().check();
    cy.contains('[data-pet-id]', 'Maple').find('[data-visit-reason="not-feeling-well"]').click();
    cy.get('textarea').first().type('Limping');
    cy.get('[data-how-soon="Flexible"]').click();
    cy.contains('Pick a Date & Time', { timeout: 40000 }).scrollIntoView();
    cy.wait(8000);
    dump('scoutpims-portal', 'body');
  });
});

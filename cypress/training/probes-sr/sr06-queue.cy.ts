/// <reference types="cypress" />
/** Probe for SR-06 and SR-07: Maria submits a request (manual scheduling), then the CL works it in Appointments. */
import '../../support/e2e';
import { signInAsScheduling } from '../../support/schedulingWorld';
import { dump, resetDemo } from './srKit';

describe('SR-06 queue', () => {
  it('Maria submits', () => {
    Cypress.config('scrollBehavior', 'center');
    resetDemo();
    cy.intercept('GET', '**/public/species-breeds?practiceId=1', { fixture: 'species-breeds.json' });
    cy.intercept('GET', '**/public/species-breeds?practiceId=1&speciesId=*', { fixture: 'breeds.json' });
    cy.intercept('POST', '**/public/appointments/form').as('submit');
    signInAsScheduling('client', '/client-portal/request-appointment');
    cy.get('input[type="tel"]', { timeout: 30000 }).should('not.have.value', '');
    cy.contains('Is this the place we are doing the visit?').parent().find('input[value="Yes"]').check();
    cy.contains('Is your mailing address the same as this location?').parent().find('input[type="radio"]').first().check();
    cy.contains('[data-pet-id]', 'Maple').find('input[type="checkbox"]').first().check();
    cy.contains('[data-pet-id]', 'Maple').find('[data-visit-reason="not-feeling-well"]').click();
    cy.get('textarea').first().type('Limping on the left hind leg since yesterday');
    cy.get('[data-how-soon="Flexible"]').click();
    cy.contains('Checking online scheduling options', { timeout: 40000 }).should('not.exist');
    cy.get('textarea[placeholder^="For example: mornings"]').type('Mornings are best, not Wednesdays');
    cy.contains('button', /^Submit$/).click();
    cy.wait('@submit', { timeout: 90000 });
    cy.wait(4000);
    dump('sr07-submitted', 'body');
    cy.screenshot('sr07-submitted', { capture: 'viewport' });
  });
  it('CL opens Appointments', () => {
    signInAsScheduling('cl', '/schedule/appointments');
    cy.wait(6000);
    dump('sr06-queue', 'body');
    cy.screenshot('sr06-queue', { capture: 'viewport' });
    signInAsScheduling('cl', '/schedule/appointments');
    cy.wait(5000);
    cy.contains('button', /^Book$/).first().click();
    cy.wait(5000);
    cy.get('body').then(($b) => {
      const doc = $b.find('input[placeholder="Type doctor name..."]');
      if (doc.length && !(doc[0] as HTMLInputElement).value) { cy.wrap(doc).type('Lane'); cy.contains('button, li', 'Avery Lane').click({ force: true }); }
    });
    cy.contains('button', /^Get Best Route$/).last().click();
    cy.wait(1500);
    cy.get('body').then(($b) => { if ($b.find('button:contains("Search anyway")').length) cy.contains('button', 'Search anyway').click(); });
    cy.contains('button', 'View Placement', { timeout: 30000 }).first().click();
    cy.wait(2500);
    cy.contains('button', /^Book$/).click();
    cy.wait(2500);
    dump('sr06-book-modal');
    cy.contains('[role="dialog"] button', /^Book appointment$/).click();
    cy.wait(2500);
    dump('sr06-after-click');
    cy.screenshot('sr06-after-click', { capture: 'viewport' });
    cy.wait(1500);
    dump('sr06-after-book', 'body');
    signInAsScheduling('cl', '/schedule/appointments');
    cy.wait(6000);
    dump('sr06-queue-after', 'body');
  });
});

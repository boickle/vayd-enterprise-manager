/// <reference types="cypress" />
/** SR-07: Maria books online. SR-26: file a received record. */
import '../../support/e2e';
import { signInAsScheduling } from '../../support/schedulingWorld';
import { dump, menuPick, openDemoDay, resetDemo, srBook } from './srKit';
describe('SR-07 and SR-26', () => {
  it.skip('SR-07: Maria picks a time', () => {
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
    cy.contains('Pick a Date & Time', { timeout: 40000 }).scrollIntoView();
    cy.wait(4000);
    dump('sr07-pick', 'body');
    cy.screenshot('sr07-pick', { capture: 'viewport' });
  });
  it('SR-26: file the record', () => {
    resetDemo();
    srBook('biscuit', 11, 0, 'recheck', 45, 'A', 'Ear recheck').then(({ id }) => {
      openDemoDay('cl');
      menuPick(id, 'Visit Prep', 'Request');
      cy.get('input[placeholder="Name of the practice"]').type('Maplewood Animal Hospital');
      cy.get('input[placeholder="records@example.com"]').type('records@maplewood-vet.example');
      cy.contains('Client has authorized us').parent().find('input[type="checkbox"]').check({ force: true });
      cy.contains('button', 'Send 1 request').click();
      cy.wait(2500);
      signInAsScheduling('cl', '/schedule/scheduling-tools/records');
      cy.wait(5000);
      cy.get('input[type="file"]').first().selectFile('cypress/training/setup/maplewood-biscuit-records.pdf', { force: true });
      cy.wait(4000);
      dump('sr26-after-file', 'body');
      cy.screenshot('sr26-after-file', { capture: 'viewport' });
      cy.contains('button', /^Received/).click();
      cy.wait(2500);
      cy.contains('button', /Review & summarize/).first().click({ force: true });
      cy.wait(30000);
      dump('sr26-review', 'body');
      cy.screenshot('sr26-review', { capture: 'viewport' });
      cy.contains('button', 'Save names & summarize records').click();
      cy.contains('Review previous records', { timeout: 120000 });
      cy.wait(3000);
      dump('sr26-reminders-tab');
      cy.contains('button', 'Review Summary First').click();
      cy.wait(2500);
      dump('sr26-summary');
      cy.screenshot('sr26-summary', { capture: 'viewport' });
    });
  });
});

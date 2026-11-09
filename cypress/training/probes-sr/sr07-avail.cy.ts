/// <reference types="cypress" />
/** Probe for SR-07: log every availability call the request form makes (status, request, first candidates). */
import '../../support/e2e';
import { signInAsScheduling } from '../../support/schedulingWorld';
import { resetDemo } from './srKit';

describe('SR-07 availability probe', () => {
  it('Maple', () => {
    Cypress.config('scrollBehavior', 'center');
    resetDemo();
    const calls: string[] = [];
    cy.intercept('GET', '**/public/species-breeds?practiceId=1', { fixture: 'species-breeds.json' });
    cy.intercept('GET', '**/public/species-breeds?practiceId=1&speciesId=*', { fixture: 'breeds.json' });
    cy.intercept('POST', '**/public/appointments/availability', (req) => {
      const sent = JSON.stringify(req.body);
      req.continue((res) => {
        const b = res.body || {};
        const c = Array.isArray(b.candidates) ? b.candidates : [];
        calls.push(`${res.statusCode} req=${sent} n=${c.length} first=${c.slice(0, 3).map((x: any) => x.date).join(',')} msg=${b.message || ''}`);
      });
    });
    signInAsScheduling('client', '/client-portal/request-appointment');
    cy.get('input[type="tel"]', { timeout: 30000 }).should('not.have.value', '');
    cy.wait(1500);
    cy.contains('Is this the place we are doing the visit?').parent().find('input[value="Yes"]').check();
    cy.contains('Is your mailing address the same as this location?').parent().find('input[type="radio"]').first().check();
    cy.contains('[data-pet-id]', 'Maple').find('input[type="checkbox"]').first().check();
    cy.contains('[data-pet-id]', 'Maple').find('[data-visit-reason="not-feeling-well"]').click();
    cy.get('textarea').first().type('Limping on the left hind leg since yesterday');
    cy.get('[data-how-soon="Flexible"]').click();
    cy.contains('Checking online scheduling options', { timeout: 40000 }).should('not.exist');
    cy.wait(15000);
    cy.contains('h2', 'Pick a Date').scrollIntoView();
    cy.screenshot('sr07-avail', { capture: 'viewport' });
    cy.contains('h2', 'Pick a Date').closest('[role="region"]').invoke('text').then((t) => {
      calls.push(`REGION: ${String(t).replace(/\s+/g, ' ').slice(0, 1200)}`);
    });
    cy.then(() => cy.writeFile('cypress/training/probes-sr/out/sr07-avail.txt', calls.join('\n')));
  });
});

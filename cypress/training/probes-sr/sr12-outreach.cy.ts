/// <reference types="cypress" />
/** Probe for SR-12: Care outreach. */
import '../../support/e2e';
import { includeSeededDoctorsInProviderList, signInAsScheduling } from '../../support/schedulingWorld';
import { dump, resetDemo } from './srKit';
describe('SR-12', () => {
  it('care outreach', () => {
    resetDemo();
    includeSeededDoctorsInProviderList();
    signInAsScheduling('cl', '/schedule/scheduling-tools/care-outreach');
    cy.wait(6000);
    dump('sr12-page', 'body');
    cy.screenshot('sr12-page', { capture: 'viewport' });
    cy.contains('button, a, label, div', /^Past due last 30 days/).first().click({ force: true });
    cy.wait(4000);
    dump('sr12-pastdue', 'body');
    cy.screenshot('sr12-pastdue', { capture: 'viewport' });
    cy.get('body').then(($b) => {
      const r = $b.find('button:contains("Route")');
      if (r.length) { cy.wrap(r.first()).click({ force: true }); cy.wait(5000); dump('sr12-route', 'body'); cy.screenshot('sr12-route', { capture: 'viewport' }); }
    });
  });
});

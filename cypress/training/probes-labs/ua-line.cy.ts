/// <reference types="cypress" />
import '../../support/e2e';
import { schedulingWorld, signInAsScheduling } from '../../support/schedulingWorld';
describe('probe UA line', () => {
  it('dumps', () => {
    cy.viewport(1600, 900);
    const w = schedulingWorld();
    const juniper = w.households.A.activePetIds[1];
    signInAsScheduling('technician', `/schedule/soap/${Cypress.env('APPT')}/${juniper}?clientId=${w.households.A.clientId}`);
    cy.contains('[id^="checkout-line-"]', 'Urinalysis', { timeout: 90000 }).should('exist');
    cy.wait(5000);
    cy.get('[id^="checkout-line-"]').then(($l) =>
      cy.writeFile(`${Cypress.env('PROBE_OUT')}/ua-lines.html`, [...$l].map((e) => e.outerHTML).join('\n\n=====\n\n')));
  });
});

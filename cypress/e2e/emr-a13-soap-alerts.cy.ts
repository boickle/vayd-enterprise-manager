/// <reference types="cypress" />
import '../support/e2e';
import { cleanEmrWorld, emrApi, seedEmrWorld, type EmrWorld } from '../support/emrWorld';

/**
 * EMR-A13-4: a pet's alerts (an allergy and a "bites" warning) show at the top of the SOAP page.
 *
 *   CYPRESS_EMR_DB=<test db> npx cypress run --spec cypress/e2e/emr-a13-soap-alerts.cy.ts
 */
describe('EMR-A13-4: patient alerts at the top of the SOAP', () => {
  let world: EmrWorld;
  before(() =>
    seedEmrWorld().then((w) => {
      world = w;
      emrApi(w, 'PATCH', `/patients/${w.visit.patientId}`, {
        alerts: 'ALLERGY: penicillin (hives)\nBITES - muzzle for nail trims',
      }).its('status').should('be.lessThan', 300);
    }),
  );
  after(() => cleanEmrWorld());

  it('shows both alerts above the chart', () => {
    cy.visit('/login');
    cy.window().then((win) => {
      win.localStorage.clear();
      win.localStorage.setItem('accessToken', world.staff.token);
    });
    cy.visit(`/schedule/soap/${world.visit.appointmentId}/${world.visit.patientId}`);
    cy.get('[data-testid="soap-patient-alerts"]', { timeout: 30000 })
      .should('contain.text', 'ALLERGY: penicillin')
      .and('contain.text', 'BITES');
  });
});

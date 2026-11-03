/// <reference types="cypress" />
import '../support/e2e';
import { stubGmailCapture } from '../support/emrCoreVisitWorld';
import { cleanEmrWorld, seedEmrWorld, type EmrWorld } from '../support/emrWorld';

/**
 * F3 / EMR-A4: the visit wrap-up must not crash when the AI recap endpoint is stubbed with an odd answer.
 * The client in the seed has an email, so the To box is filled (only a "Do not email" client leaves it empty).
 *
 *   CYPRESS_EMR_DB=vayd_api_test npx cypress run --spec cypress/e2e/emr-f3-wrapup-recap-stub.cy.ts
 */
describe('F3: wrap-up after "Regenerate from charts" with a stubbed recap writer', () => {
  let world: EmrWorld;
  before(() => seedEmrWorld().then((w) => (world = w)));
  after(() => cleanEmrWorld());

  function open() {
    stubGmailCapture();
    cy.visit('/login');
    cy.window().then((win) => {
      win.localStorage.clear();
      win.localStorage.setItem('accessToken', world.staff.token);
    });
    const { appointmentId, patientId } = world.visit;
    cy.visit(`/schedule/soap/${appointmentId}/${patientId}/wrap-up?clientId=${world.client.id}`);
  }

  it('an empty answer shows an error, not "Something went wrong"', () => {
    cy.intercept('POST', '**/scribe/client-recap', { statusCode: 200, body: {} }).as('recap');
    open();
    cy.contains('button', 'Regenerate from charts', { timeout: 40000 }).scrollIntoView().should('not.be.disabled').click();
    cy.wait('@recap');
    cy.contains(/recap writer returned nothing usable/i).should('be.visible');
    cy.contains('Something went wrong').should('not.exist');
  });

  it('a realistic answer fills the draft', () => {
    cy.intercept('POST', '**/scribe/client-recap', {
      statusCode: 200,
      body: { subject: 'Juniper visit recap', body: 'Thanks for having us out.', pets: [] },
    }).as('recap');
    open();
    cy.contains('button', 'Regenerate from charts', { timeout: 40000 }).scrollIntoView().should('not.be.disabled').click();
    cy.wait('@recap');
    cy.get('input[value="Juniper visit recap"]').should('exist');
    cy.contains('Something went wrong').should('not.exist');
  });
});

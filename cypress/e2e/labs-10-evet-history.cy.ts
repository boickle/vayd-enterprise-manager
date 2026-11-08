/// <reference types="cypress" />
import '../support/e2e';
import { cleanLabsWorld, labsWorld, seedLabsWorld, signInLabs } from '../support/labsWorld';

/**
 * LAB-10-5: eVet in-house history on the chart and in records sent out.
 * The Labs seed gives Waffles (household "history") eVet form 6809 with elements 15876-15880 (15880 = POSITIVE)
 * and loads a small name mapping (form "Heartworm 4Dx (eVet)", 15880 = "Anaplasma").
 * Run: CYPRESS_LABS_DB=<test db> (API on the same database, migrations applied)
 *      npx cypress run --spec cypress/e2e/labs-10-evet-history.cy.ts
 * Nothing is emailed: the PDF is only built and handed to window.open (stubbed).
 */
describe('LAB-10-5: eVet in-house history', () => {
  before(() => {
    seedLabsWorld();
  });
  after(() => {
    cleanLabsWorld();
  });

  const openChart = () => {
    const w = labsWorld();
    cy.viewport(1440, 1000);
    signInLabs('veterinarian', `/schedule/patients?patientId=${w.evetHistory.patientId}`);
    cy.contains('button', 'All dates', { timeout: 40000 }).click();
  };

  it('the chart shows the eVet result with names from the mapping', () => {
    openChart();
    cy.get('[data-chart-row-id^="evetInHouseLab:"]', { timeout: 30000 }).should('have.length', 1).as('row');
    cy.get('@row').should('contain.text', 'Heartworm 4Dx (eVet)');
    cy.get('@row').click();
    // The values open in the row's body, a sibling table row directly under it.
    cy.get('@row').next('tr').as('body');
    cy.get('@body').should('contain.text', 'Anaplasma: POSITIVE');
    cy.get('@body').should('contain.text', 'Heartworm Ag: NEGATIVE');
  });

  it('a result is read only and its raw element id is never the only label', () => {
    openChart();
    cy.get('[data-chart-row-id^="evetInHouseLab:"]', { timeout: 30000 }).click().as('row');
    cy.get('@row').next('tr').as('body').should('contain.text', 'Anaplasma: POSITIVE');
    cy.get('@row').should('not.contain.text', 'Unnamed eVet field');
    cy.get('@body').should('not.contain.text', 'Unnamed eVet field');
    // Read only: no editable field in the row or its body. (The row's "Select" checkbox is for emailing/printing, not a value.)
    const editable = 'input:not([type="checkbox"]), textarea, select, [contenteditable="true"]';
    cy.get('@row').find(editable).should('have.length', 0);
    cy.get('@body').find(editable).should('have.length', 0);
  });

  it('printing the whole chart builds the PDF with the eVet result in it', () => {
    openChart();
    cy.window().then((win) => {
      cy.stub(win, 'open').as('open').returns({ closed: false, focus: () => undefined } as unknown as Window);
    });
    cy.get('[data-chart-row-id^="evetInHouseLab:"]', { timeout: 30000 }).should('exist');
    cy.get('[aria-label="Print all records"]').click();
    cy.get('@open', { timeout: 30000 }).should('have.been.called');
  });
});

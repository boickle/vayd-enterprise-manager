/// <reference types="cypress" />
import '../support/e2e';
import { PENDING_LABS_PATH, cleanLabsWorld, labsWorld, seedLabsWorld, signInLabs } from '../support/labsWorld';

/**
 * H-LAB smoke: the Labs world seeds, the tech's login works, and the Pending Labs page opens.
 * Run: CYPRESS_LABS_DB=vayd_api_test_e2e (API on the same database) npx cypress run --spec cypress/e2e/labs-00-smoke.cy.ts
 */
describe('LABS-00: Labs seed smoke', () => {
  before(() => {
    seedLabsWorld();
  });
  after(() => {
    cleanLabsWorld();
  });

  it('the tech opens Pending Labs', () => {
    const w = labsWorld();
    expect(w.households.two.pets.map((p) => p.name)).to.deep.equal(['Max', 'Bella']);
    signInLabs('technician', PENDING_LABS_PATH);
    cy.location('pathname', { timeout: 30000 }).should('eq', PENDING_LABS_PATH);
    cy.get('.pending-labs__day, .pending-labs__empty', { timeout: 30000 }).should('exist');
  });
});

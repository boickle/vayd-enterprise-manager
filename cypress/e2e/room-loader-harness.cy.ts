/// <reference types="cypress" />

/**
 * H-RL smoke: seed a sent room loader through the cypress task and open its public form link.
 * Needs the API running against vayd_api_test and the frontend dev server pointed at that API
 * (see cypress.config.ts, "H-RL: room-loader seeding").
 */
describe('H-RL: room loader seed task', () => {
  after(() => {
    cy.task('cleanRoomLoader');
  });

  it('opens the public form for a seeded loader and shows the pet name', () => {
    cy.task<{ path: string; petName: string }>('seedRoomLoader').then(({ path, petName }) => {
      cy.visit(path);
      cy.contains(petName, { timeout: 20000 }).should('be.visible');
    });
  });
});

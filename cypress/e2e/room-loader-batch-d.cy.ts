/// <reference types="cypress" />

/**
 * Room Loader go-live plan (vayd-api docs/test-plans/room-loader.md), batch D, end-to-end: RL-07-7.
 *
 * Seeds a sent two-pet room loader (Max, Bella) where Bella was marked deceased after the death
 * wrap-up, with the cypress task `seedRoomLoader` and a `scenario` object (convention of
 * room-loader-batch-b.cy.ts):
 *   { pets: 2, petNames: ['Max', 'Bella'], inactivePets: ['Bella'] }
 * The task must honour `inactivePets` (patients.isActive = false for those names).
 *
 * Status: written, NOT run. The captured-email half of RL-07-7 is covered by the backend
 * integration case RL-07-1 (subject names only Max), since Cypress cannot read the API's mail fake.
 */
type Seeded = { loaderId: number; token: string; petName: string; path: string };

const seed = (scenario: Record<string, unknown> = {}) =>
  cy.task<Seeded>('seedRoomLoader', { scenario });

after(() => {
  cy.task('cleanRoomLoader');
});

describe('RL-07-7: a deceased pet is nowhere on the check-in (end to end)', () => {
  it('the public form shows only Max after Bella is marked deceased (needs scenario)', () => {
    seed({ pets: 2, petNames: ['Max', 'Bella'], inactivePets: ['Bella'] }).then((s) => {
      cy.visit(s.path);
      cy.contains('Max', { timeout: 20000 }).should('be.visible');
      cy.contains('Bella').should('not.exist');
      cy.get('body').invoke('text').should('not.match', /Bella/);
    });
  });
});

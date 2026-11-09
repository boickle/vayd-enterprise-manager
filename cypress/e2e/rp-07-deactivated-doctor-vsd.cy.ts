/// <reference types="cypress" />
import '../support/e2e';

/**
 * RP-07-3 (written, not run): a deactivated doctor's production stays in VSD.
 * Seed with vayd-api test/scripts/rp-07-e2e-seed.ts (a vayd_api_test* database only):
 *   npx ts-node -T test/scripts/rp-07-e2e-seed.ts seed vayd_api_test_x /tmp/rp07-world.json
 *   CYPRESS_RP07_WORLD="$(cat /tmp/rp07-world.json)" npx cypress run --spec cypress/e2e/rp-07-deactivated-doctor-vsd.cy.ts
 *   npx ts-node -T test/scripts/rp-07-e2e-seed.ts clean vayd_api_test_x /tmp/rp07-world.json
 * The seed puts today's treatment lines on doctor A (100 + 150) and doctor B (50), then deactivates A, and
 * mints an admin login (VSD is an admin report). The page opens on Today; the database sums are in the seed JSON.
 * Doctor Revenue (src/pages/DoctorRevenueAnalytics.tsx) is not reachable from any route today, so it is covered by
 * the same list endpoint but not driven here.
 * Assumes no other production dated today in the test database.
 */
type Rp07World = {
  today: string;
  departedDoctorId: number;
  departedDoctorName: string;
  departedTotal: number;
  seededTotal: number;
  adminToken: string;
};
const world = (): Rp07World => {
  const raw = Cypress.env('RP07_WORLD') as string | Rp07World | undefined;
  if (!raw) throw new Error('Set CYPRESS_RP07_WORLD to the JSON from rp-07-e2e-seed.ts');
  return typeof raw === 'string' ? (JSON.parse(raw) as Rp07World) : raw;
};
const usd = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);

describe('RP-07: deactivated doctor stays in VSD', () => {
  it('RP-07-3: the departed doctor has a (Deactivated) row and the practice total matches the database sum', () => {
    const w = world();
    cy.visit('/login');
    cy.window().then((win) => {
      win.localStorage.clear();
      win.localStorage.setItem('accessToken', w.adminToken);
    });
    cy.visit('/analytics/vsd');

    cy.contains(`${w.departedDoctorName} (Deactivated)`, { timeout: 30000 }).should('be.visible');
    cy.contains(`${w.departedDoctorName} (Deactivated)`)
      .closest('li')
      .should('contain.text', usd(w.departedTotal));
    cy.contains('Practice total:', { timeout: 30000 }).should('contain.text', usd(w.seededTotal));
  });
});

/// <reference types="cypress" />
import '../support/e2e';

/**
 * RP-04-7 (written, not run): a practice manager with an admin login cannot credential themselves.
 * Seed with vayd-api test/scripts/rp-04-e2e-seed.ts (a vayd_api_test* database only):
 *   npx ts-node -T test/scripts/rp-04-e2e-seed.ts seed vayd_api_test_x /tmp/rp04-world.json
 *   CYPRESS_RP04_WORLD="$(cat /tmp/rp04-world.json)" npx cypress run --spec cypress/e2e/roles-rp-04-own-access-locked.cy.ts
 *   npx ts-node -T test/scripts/rp-04-e2e-seed.ts clean vayd_api_test_x /tmp/rp04-world.json
 * The manager signs in, opens their own Access tab, finds the license radios and grant controls disabled with the
 * hint, then forces the license call and an own-role change straight at the API: both 403, and the database
 * (read back through the API) is unchanged.
 */
type Rp04World = { managerEmployeeId: number; managerToken: string; veterinarianRoleId: number; branchId: number };
const world = (): Rp04World => {
  const raw = Cypress.env('RP04_WORLD') as string | Rp04World | undefined;
  if (!raw) throw new Error('Set CYPRESS_RP04_WORLD to the JSON from rp-04-e2e-seed.ts');
  return typeof raw === 'string' ? (JSON.parse(raw) as Rp04World) : raw;
};
const apiBase = () =>
  Cypress.env('API_URL') ||
  Cypress.config('baseUrl')?.replace(':5173', ':3000') ||
  'http://localhost:3000';
const asManager = (method: 'GET' | 'PUT', path: string, body?: unknown) =>
  cy.request({
    method,
    url: `${apiBase()}${path}`,
    headers: { Authorization: `Bearer ${world().managerToken}` },
    body: body as Cypress.RequestBody,
    failOnStatusCode: false,
  });

describe('RP-04-7: your own Access tab is locked', () => {
  it('controls are disabled, forced calls are refused, the database is unchanged', () => {
    const w = world();
    cy.visit('/login');
    cy.window().then((win) => {
      win.localStorage.clear();
      win.localStorage.setItem('accessToken', w.managerToken);
    });
    cy.visit(`/schedule/settings?tab=employee-directory&employee=${w.managerEmployeeId}&section=access`);

    cy.contains('h3', 'License', { timeout: 30000 }).should('be.visible');
    cy.get('input[name="employee-license"]').should('have.length', 3).each(($radio) => {
      expect($radio).to.have.attr('disabled');
    });
    // The Access tab sits in a fixed-position panel that scrolls; bring the hint into view first.
    cy.contains('Ask a practice admin to change your own access.').scrollIntoView().should('be.visible');

    // Forced license call.
    asManager('PUT', `/practice/1/employees/${w.managerEmployeeId}/permissions/license`, {
      isLicensed: true,
      licenseType: 'veterinarian',
    })
      .its('status')
      .should('eq', 403);
    // Forced own-role change.
    asManager('PUT', `/employees/${w.managerEmployeeId}/roles`, {
      roleAssignments: [{ roleId: w.veterinarianRoleId, branchId: w.branchId }],
    })
      .its('status')
      .should('eq', 403);

    // Nothing changed.
    asManager('GET', `/practice/1/employees/${w.managerEmployeeId}/permissions`).then((res) => {
      expect(res.status).to.eq(200);
      expect(res.body.isLicensed).to.eq(false);
      expect(res.body.roleSlugs).to.not.include('veterinarian');
    });
  });
});

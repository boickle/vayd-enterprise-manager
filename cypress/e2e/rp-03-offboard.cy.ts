/// <reference types="cypress" />
import '../support/e2e';

/**
 * RP-03 Offboard, end to end (written, not run): RP-03-6, RP-03-8 and RP-03-19.
 * docs/test-plans/roles-and-permissions.md (vayd-api), owner spec RP-03 (Nov 8, 2026).
 *
 * Seed with vayd-api test/scripts/rp-03-e2e-seed.ts (a vayd_api_test* database only):
 *   npx ts-node -T test/scripts/rp-03-e2e-seed.ts seed vayd_api_test_x /tmp/rp03-world.json
 *   CYPRESS_RP03_WORLD="$(cat /tmp/rp03-world.json)" CYPRESS_E2E_DB=vayd_api_test_x \
 *     npx cypress run --spec cypress/e2e/rp-03-offboard.cy.ts
 *   npx ts-node -T test/scripts/rp-03-e2e-seed.ts clean vayd_api_test_x /tmp/rp03-world.json
 * The API the dev server talks to must use the same database. Offboarding is one-way, so re-seed before
 * each run. The seeded clients are blocked from email and text; nothing reaches Stripe.
 */
type Person = { employeeId: number; userId: number; name: string; token?: string; email?: string };
type Rp03World = {
  practiceId: number;
  visitIds: number[];
  doctorA: Person & { token: string };
  doctorB: Person;
  leaver: Person & { email: string };
  /** An active vet who takes over a visit. */
  stayingDoctor: Person;
  managerEmployeeId: number;
  clToken: string;
  managerToken: string;
  adminToken: string;
};

const world = (): Rp03World => {
  const raw = Cypress.env('RP03_WORLD') as string | (Rp03World & { world?: unknown }) | undefined;
  if (!raw) throw new Error('Set CYPRESS_RP03_WORLD to the JSON from rp-03-e2e-seed.ts');
  return typeof raw === 'string' ? (JSON.parse(raw) as Rp03World) : raw;
};
const apiBase = () =>
  Cypress.env('API_URL') ||
  Cypress.config('baseUrl')?.replace(':5173', ':3000') ||
  'http://localhost:3000';
const api = (token: string, method: string, path: string, body?: unknown) =>
  cy.request({
    method,
    url: `${apiBase()}${path}`,
    headers: { Authorization: `Bearer ${token}` },
    body: body as Cypress.RequestBody,
    failOnStatusCode: false,
  });
const db = () => String(Cypress.env('E2E_DB') || 'vayd_api_test_e2e');
const sql = (statement: string): Cypress.Chainable<string> => {
  if (!/test/i.test(db()) || /vayd_api_local|prod/i.test(db())) {
    throw new Error(`Refusing: "${db()}" is not a dedicated test database`);
  }
  return cy
    .exec('psql -h localhost -U vayd -d ' + db() + ' -tA -c "$RP03_SQL"', {
      env: { PGPASSWORD: 'vayd', RP03_SQL: statement },
    })
    .then((r) => r.stdout.trim().split('\n')[0] ?? '');
};
const signIn = (token: string, path: string) => {
  cy.visit('/login');
  cy.window().then((win) => {
    win.localStorage.clear();
    win.localStorage.setItem('accessToken', token);
  });
  cy.visit(path);
};
/** Yesterday in Eastern time, so the last day is already over and everything happens now. */
const yesterdayEastern = () => {
  const now = new Date(Date.now() - 864e5);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(now);
};

describe('RP-03 Offboard', () => {
  it('RP-03-6 screen to database: the dialog says the login ends, the vet is signed out, Admin → Users shows Inactive', () => {
    const w = world();
    // The vet's second session works before.
    api(w.doctorA.token, 'GET', '/clients/search?q=rp03').its('status').should('eq', 200);

    signIn(
      w.adminToken,
      `/schedule/settings?tab=employee-directory&employee=${w.doctorA.employeeId}&section=profile`
    );
    cy.contains('button', /^Offboard$/, { timeout: 20000 }).click();
    cy.get('[role="dialog"][aria-labelledby="employee-offboard-title"]').within(() => {
      cy.get('[data-testid="offboard-summary"]')
        .should('contain.text', 'login')
        .and('contain.text', 'ends');
      cy.get('input[aria-label="Last day"]').clear().type(yesterdayEastern());
      cy.get('select[aria-label="Their tasks go to"]').select(String(w.managerEmployeeId));
      cy.contains('button', /^Offboard$/).click();
    });
    cy.contains(/Offboarded\. Their login has ended/, { timeout: 20000 });

    // The vet's next request (their next click) is refused, so the app sends them to sign-in.
    api(w.doctorA.token, 'GET', '/clients/search?q=rp03').its('status').should('eq', 401);
    signIn(w.doctorA.token, '/schedule/scheduler');
    cy.location('pathname', { timeout: 20000 }).should('match', /login/);

    // Admin → Users shows the login Inactive.
    signIn(w.adminToken, '/admin/users');
    cy.contains('tr', w.doctorA.name, { timeout: 20000 }).should('contain.text', 'Inactive');
    sql(`SELECT "isActive" FROM users WHERE id = ${w.doctorA.userId}`).should('eq', 'f');
  });

  it('RP-03-8 future visits stay movable: "(Deactivated)" calendar, no free slots, a Rebook task', () => {
    const w = world();
    api(w.managerToken, 'POST', `/employee-offboarding/${w.doctorB.employeeId}`, {
      lastDay: yesterdayEastern(),
      taskToEmployeeId: w.managerEmployeeId,
    }).then((res) => {
      expect(res.status).to.be.lessThan(300);
      expect(res.body.rebookTaskId, 'Rebook task').to.be.a('number');
      sql(`SELECT title FROM tasks WHERE id = ${res.body.rebookTaskId}`).should(
        'match',
        /^Rebook Dr\. .*'s visits$|^Rebook .*'s visits$/
      );
    });

    // A client liaison opens the Scheduler: the calendar is listed, labelled (Deactivated).
    signIn(w.clToken, '/schedule/scheduler');
    cy.contains('label', 'Primary provider', { timeout: 30000 })
      .find('select')
      .find('option')
      .contains(`${w.doctorB.name} (Deactivated)`)
      .then((opt) => {
        cy.contains('label', 'Primary provider').find('select').select(String(opt.val()));
      });

    // No free time for them.
    api(w.clToken, 'POST', '/public/appointments/availability', {
      practiceId: w.practiceId,
      doctorId: w.doctorB.employeeId,
      startDate: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(
        new Date(Date.now() + 7 * 864e5)
      ),
      numDays: 5,
      serviceMinutes: 60,
      skipCache: true,
    })
      .its('body.candidates')
      .should('deep.equal', []);

    // The visits are still booked with them and can be moved to another doctor (the Scheduler's drag
    // saves this same PATCH).
    sql(
      `SELECT COUNT(*) FROM appointments WHERE id IN (${w.visitIds.join(',')}) AND "isActive" = true AND "primaryProviderId" = ${w.doctorB.employeeId}`
    ).should('eq', '3');
    api(w.clToken, 'PATCH', `/appointments/${w.visitIds[0]}`, {
      primaryProviderId: w.stayingDoctor.employeeId,
    })
      .its('status')
      .should('be.lessThan', 300);
    sql(`SELECT "primaryProviderId" FROM appointments WHERE id = ${w.visitIds[0]}`).should(
      'eq',
      String(w.stayingDoctor.employeeId)
    );
  });

  it('RP-03-19 Admin → Users: turning the login off opens the same Offboard dialog; Cancel leaves everything as it was', () => {
    const w = world();
    signIn(w.adminToken, '/admin/users');
    cy.contains('tr', w.leaver.email, { timeout: 20000 }).within(() => {
      cy.contains('button', 'Edit').click();
    });
    cy.contains('label', 'Active').find('input[type="checkbox"]').should('be.checked').uncheck();
    cy.get('[role="dialog"][aria-labelledby="employee-offboard-title"]', { timeout: 10000 })
      .should('contain.text', `Offboard ${w.leaver.name}`)
      .within(() => {
        cy.contains('button', /^Cancel$/).click();
      });
    cy.get('[aria-labelledby="employee-offboard-title"]').should('not.exist');
    cy.contains('label', 'Active').find('input[type="checkbox"]').should('be.checked');

    // Nothing half-done: the login, the employee and their offboarding are untouched.
    sql(`SELECT "isActive" FROM users WHERE id = ${w.leaver.userId}`).should('eq', 't');
    sql(`SELECT "isActive" FROM employees WHERE id = ${w.leaver.employeeId}`).should('eq', 't');
    sql(
      `SELECT COUNT(*) FROM employee_offboardings WHERE "employeeId" = ${w.leaver.employeeId}`
    ).should('eq', '0');
  });
});

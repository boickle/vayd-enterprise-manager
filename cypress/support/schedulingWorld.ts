/**
 * The seeded scheduling world for the scheduling and routing end-to-end specs.
 *
 * Seed it with vayd-api's test/scripts/scheduling-e2e-seed.ts (a vayd_api_test* database only) and pass the JSON:
 *   CYPRESS_SCHEDULING_WORLD="$(cat sch-world.json)" npx cypress run --spec cypress/e2e/scheduling-*.cy.ts
 */
export type SchRole = 'cl' | 'technician' | 'manager' | 'doctorA' | 'doctorB' | 'client';
export type SchTypeKey =
  | 'medical'
  | 'recheck'
  | 'wellness'
  | 'euthanasia'
  | 'qol'
  | 'hold'
  | 'premeds';

export type SchedulingWorld = {
  practiceId: number;
  tag: string;
  branchId: number;
  zoneId: number;
  types: Record<SchTypeKey, number>;
  employees: Record<Exclude<SchRole, 'client'>, number>;
  doctors: { A: number; B: number };
  households: {
    A: {
      clientId: number;
      activePetIds: [number, number];
      inactivePetId: number;
      lat: number;
      lon: number;
    };
    B: { clientId: number; petId: number; lat: number; lon: number };
  };
  users: Record<SchRole, number>;
  auth: Record<SchRole, { Authorization: string; token: string }>;
};

export function schedulingWorld(): SchedulingWorld {
  const raw = Cypress.env('SCHEDULING_WORLD') as string | SchedulingWorld | undefined;
  if (!raw) throw new Error('Set CYPRESS_SCHEDULING_WORLD to the JSON from scheduling-e2e-seed.ts');
  return typeof raw === 'string' ? (JSON.parse(raw) as SchedulingWorld) : raw;
}

const apiBase = () =>
  Cypress.env('API_URL') ||
  Cypress.config('baseUrl')?.replace(':5173', ':3000') ||
  'http://localhost:3000';

/** Calls the API as one of the seeded logins; yields the response body. Pass failOnStatusCode false to test refusals. */
export function schedulingApi<T = any>(
  role: SchRole,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
  failOnStatusCode = true
): Cypress.Chainable<Cypress.Response<T>> {
  const w = schedulingWorld();
  return cy.request({
    method,
    url: `${apiBase()}${path}`,
    headers: { Authorization: w.auth[role].Authorization },
    body: body as Cypress.RequestBody,
    failOnStatusCode,
  }) as Cypress.Chainable<Cypress.Response<T>>;
}

/** Signs in as a seeded login (no password) and opens `path`. */
export function signInAsScheduling(role: SchRole, path: string) {
  const w = schedulingWorld();
  cy.visit('/login');
  cy.window().then((win) => {
    win.localStorage.clear();
    win.localStorage.setItem('accessToken', w.auth[role].token);
  });
  cy.visit(path);
}

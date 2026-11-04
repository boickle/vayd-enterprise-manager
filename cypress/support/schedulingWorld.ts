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

/**
 * The API serves GET /employees/providers from a Redis cache (EMPLOYEES_PROVIDERS_CACHE_*) that a test API can
 * share with another environment, so the seeded doctors may be missing from the Scheduler's provider list.
 * This adds them to that one response (setup only; nothing under test reads it).
 */
export function includeSeededDoctorsInProviderList() {
  const w = schedulingWorld();
  cy.intercept('GET', '**/employees/providers*', (req) => {
    delete req.headers['if-none-match']; // a 304 has no body to patch
    delete req.headers['if-modified-since'];
    req.continue((res) => {
      const rows: any[] = Array.isArray(res.body) ? res.body : (res.body?.items ?? []);
      const seeded = (['A', 'B'] as const)
        .filter((k) => !rows.some((r) => Number(r.id) === w.doctors[k]))
        .map((k) => ({
          id: w.doctors[k],
          firstName: 'Sched',
          lastName: `doctor${k}`,
          isProvider: true,
          isActive: true,
          isDeleted: false,
        }));
      const out = Array.isArray(res.body)
        ? [...rows, ...seeded]
        : { ...res.body, items: [...rows, ...seeded] };
      res.setDelay(0);
      res.send(200, out, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    });
  });
}

/**
 * Removes (soft delete, the Scheduler's own DELETE) the upcoming visits of both seeded households, so a spec
 * that books fixed times starts from an empty calendar even after an earlier run left visits behind.
 */
export function clearSeededHouseholdVisits() {
  const w = schedulingWorld();
  const mine = new Set([w.households.A.clientId, w.households.B.clientId]);
  const start = new Date().toISOString();
  const end = new Date(Date.now() + 45 * 864e5).toISOString();
  for (const doctorId of [w.doctors.A, w.doctors.B]) {
    schedulingApi<any>(
      'manager',
      'GET',
      `/appointments/range?practiceId=${w.practiceId}&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&primaryProviderId=${doctorId}`
    ).then((res) => {
      const rows: any[] = Array.isArray(res.body) ? res.body : (res.body?.items ?? []);
      // A visit whose chart has started cannot be removed (SCH-15); those stay (failOnStatusCode false).
      rows
        .filter((a) => mine.has(Number(a.client?.id ?? a.clientId)))
        .forEach((a) => schedulingApi('manager', 'DELETE', `/appointments/${a.id}`, undefined, false));
    });
  }
}

/**
 * The seeded catalog world for the catalog and pricing end-to-end specs.
 *
 * Seed it with vayd-api's test/scripts/catalog-e2e-seed.ts and pass the JSON it writes:
 *   CYPRESS_CATALOG_WORLD="$(cat cat-world.json)" npx cypress run --spec cypress/e2e/catalog-*.cy.ts
 */
export type CatRole =
  | 'practice_manager'
  | 'client_liaison'
  | 'technician'
  | 'veterinarian'
  | 'lead_client_liaison'
  | 'admin';

export type CatalogWorld = {
  tag: string;
  practiceId: number;
  branchId: number;
  taxSettingsId: number;
  items: {
    hiddenPricedId: number;
    hiddenZeroId: number;
    feeMinimumId: number;
    interyellowId: number;
    noDiscountId: number;
    costPlusId: number;
    storeId: number;
    procedureId: number;
    labId: number;
  };
  clients: {
    seniorStatusId: number;
    employeeStatusId: number;
    seniorClientId: number;
    employeeClientId: number;
    seniorPatientId: number;
    employeePatientId: number;
  };
  autoshipActivePet: { subscriptionId: number; stripeSubscriptionId: string; clientId: number; patientId: number };
  autoshipInactivePet: { subscriptionId: number; stripeSubscriptionId: string; clientId: number; patientId: number };
  employees: Record<Exclude<CatRole, 'admin'>, number>;
  auth: Record<CatRole, { Authorization: string; token: string }>;
};

export function catalogWorld(): CatalogWorld {
  const raw = Cypress.env('CATALOG_WORLD') as string | CatalogWorld | undefined;
  if (!raw) throw new Error('Set CYPRESS_CATALOG_WORLD to the JSON from catalog-e2e-seed.ts');
  return typeof raw === 'string' ? (JSON.parse(raw) as CatalogWorld) : raw;
}

const apiBase = () =>
  Cypress.env('API_URL') || Cypress.config('baseUrl')?.replace(':5173', ':3000') || 'http://localhost:3000';

/** Calls the API as one of the seeded staff; yields the response body. */
export function catalogApi<T = any>(
  role: CatRole,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown
): Cypress.Chainable<T> {
  const w = catalogWorld();
  return cy
    .request({
      method,
      url: `${apiBase()}${path}`,
      headers: { Authorization: w.auth[role].Authorization },
      body: body as Cypress.RequestBody,
      failOnStatusCode: true,
    })
    .its('body') as Cypress.Chainable<T>;
}

/** Signs in as a seeded staff member (no password) and opens `path`. */
export function signInAsCatalog(role: CatRole, path: string) {
  const w = catalogWorld();
  cy.visit('/login');
  cy.window().then((win) => {
    win.localStorage.clear();
    win.localStorage.setItem('accessToken', w.auth[role].token);
  });
  cy.visit(path);
}

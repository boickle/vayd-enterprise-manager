/// <reference types="cypress" />
/**
 * The seeded Labs world (H-LAB) for cypress/e2e/labs-*.cy.ts. Seeded by vayd-api's
 * test/scripts/labs-e2e-seed.ts into a database whose name contains "test":
 *   cy.task('seedLabsWorld')  (cypress.config.ts runs the seed against LABS_DB, default vayd_api_test_e2e)
 * or by hand:
 *   npx ts-node -T test/scripts/labs-e2e-seed.ts seed vayd_api_test_e2e /tmp/labs-world.json
 *   CYPRESS_LABS_WORLD="$(cat /tmp/labs-world.json)" npx cypress run --spec "cypress/e2e/labs-*.cy.ts"
 * The API the dev server talks to must use the same database. To fake IDEXX in the browser stack, start that API
 * with IDEXX_FAKE_STATE=/path/state.json (see vayd-api src/idexx/fake-idexx.client.ts for the file's shape).
 */
export type LabsRole = 'veterinarian' | 'technician' | 'lead_technician' | 'client_liaison' | 'inventory_manager' | 'admin';

export type LabsPet = { patientId: number; name: string; species: string; appointmentId: number | null };
export type LabsHousehold = { clientId: number; email: string; pets: LabsPet[] };

export type LabsWorld = {
  tag: string;
  practiceId: number;
  branchId: number;
  locationId: number;
  items: { examId: number };
  labs: { bloodGlucoseId: number; heartworm4dxId: number; urineDipstickId: number; chem25Id: number; uaId: number; t4Id: number };
  procedures: { schirmerId: number; fluoresceinId: number };
  forms: { bloodGlucoseId: number; fluoresceinId: number; heartworm4dxId: number; schirmerId: number; urineDipstickId: number };
  idexxCodes: { chem25: string; ua: string; t4: string };
  staffStatusId: number;
  plus: { packageId: number; planId: number; patientId: number };
  evetHistory: {
    patientId: number;
    treatmentId: number;
    treatmentItemId: number;
    labFormResultId: number;
    labFormPimsId: string;
    elementPimsIds: number[];
    positiveElementPimsId: number;
  };
  employees: Record<Exclude<LabsRole, 'admin'>, number>;
  users: Record<LabsRole, number>;
  auth: Record<LabsRole, { Authorization: string; token: string }>;
  /** two: Max and Bella; staff: Biscuit (account status Staff); member: Clover (PLUS); history: Waffles (eVet rows, no appointment). */
  households: Record<'two' | 'staff' | 'member' | 'history', LabsHousehold>;
};

export function labsWorld(): LabsWorld {
  const raw = Cypress.env('LABS_WORLD') as string | LabsWorld | undefined;
  if (!raw) throw new Error('Set CYPRESS_LABS_WORLD to the JSON from labs-e2e-seed.ts (or run cy.task("seedLabsWorld") first)');
  return typeof raw === 'string' ? (JSON.parse(raw) as LabsWorld) : raw;
}

/** Seeds the world through the cypress.config.ts task and stores it where labsWorld() reads it. */
export function seedLabsWorld(): Cypress.Chainable<LabsWorld> {
  return cy.task<LabsWorld>('seedLabsWorld', null, { timeout: 120000 }).then((w) => {
    Cypress.env('LABS_WORLD', w);
    return w;
  });
}

export function cleanLabsWorld() {
  return cy.task('cleanLabsWorld', null, { timeout: 120000 });
}

const apiBase = () => Cypress.env('API_URL') || Cypress.config('baseUrl')?.replace(':5173', ':3000') || 'http://localhost:3000';

/** Calls the API as one of the seeded staff; yields the response body. */
export function labsApi<T = any>(role: LabsRole, method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown): Cypress.Chainable<T> {
  return cy
    .request({
      method,
      url: `${apiBase()}${path}`,
      headers: { Authorization: labsWorld().auth[role].Authorization },
      body: body as Cypress.RequestBody,
      failOnStatusCode: true,
    })
    .its('body') as Cypress.Chainable<T>;
}

/** Signs in as a seeded staff member (no password) and opens `path`. */
export function signInLabs(role: LabsRole, path: string) {
  const w = labsWorld();
  cy.visit('/login');
  cy.window().then((win) => {
    win.localStorage.clear();
    win.localStorage.setItem('accessToken', w.auth[role].token);
  });
  cy.visit(path);
}

/** Opening a pet's SOAP (the bill is made from it). */
export const labsSoapPath = (pet: LabsPet, clientId: number, tail = '') =>
  `/schedule/soap/${pet.appointmentId}/${pet.patientId}${tail}?clientId=${clientId}`;

export const PENDING_LABS_PATH = '/schedule/in-house-labs';

/** Catalog item name as the seed made it (every name starts with the world's tag). */
export const labsItemName = (name: string) => `${labsWorld().tag} ${name}`;

/**
 * The seeded inventory world for the inventory end-to-end specs (cypress/e2e/inventory-*.cy.ts).
 *
 * Seed it with vayd-api's test/scripts/inventory-e2e-seed.ts and pass the JSON it writes:
 *   CYPRESS_INVENTORY_WORLD="$(cat world.json)" npx cypress run --spec cypress/e2e/inventory-*.cy.ts
 */
export type Role = 'inventoryManager' | 'technician' | 'practiceManager';

export type InventoryWorld = {
  tag: string;
  practiceId: number;
  clientId: number;
  patientId: number;
  /** A paid store order for one 180-count bottle, waiting to be filled. */
  mailOrderId: number;
  supplierId: number;
  counted: { branchId: number; mainLocationId: number; carLocationId: number };
  uncounted: { branchId: number; mainLocationId: number; carLocationId: number };
  items: {
    stockId: number;
    bottle30Id: number;
    bottle60Id: number;
    bottle180Id: number;
    vaccineId: number;
    controlledWeightId: number;
    controlledVolumeId: number;
  };
  lots: {
    expiredLotId: number;
    currentLotId: number;
    expiredLotNumber: string;
    currentLotNumber: string;
  };
  employees: Record<Role, number>;
  auth: Record<Role, { Authorization: string; token: string }>;
};

export function inventoryWorld(): InventoryWorld {
  const raw = Cypress.env('INVENTORY_WORLD') as string | InventoryWorld | undefined;
  if (!raw) throw new Error('Set CYPRESS_INVENTORY_WORLD to the JSON from inventory-e2e-seed.ts');
  return typeof raw === 'string' ? (JSON.parse(raw) as InventoryWorld) : raw;
}

export const apiBase = () =>
  Cypress.config('baseUrl')?.replace(':5173', ':3000') ?? 'http://localhost:3000';

/** Calls the API as one of the seeded staff; yields the response body. */
export function api<T = any>(
  role: Role,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown
): Cypress.Chainable<T> {
  const w = inventoryWorld();
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
export function signInAs(role: Role, path: string, extraStorage: Record<string, string> = {}) {
  const w = inventoryWorld();
  cy.visit('/login');
  cy.window().then((win) => {
    win.localStorage.clear();
    win.localStorage.setItem('accessToken', w.auth[role].token);
    for (const [k, v] of Object.entries(extraStorage)) win.localStorage.setItem(k, v);
  });
  cy.visit(path);
}

/** The Receive screen's saved in-progress receive, so a draft made through the API opens there. */
export function receiveDraftStorage(
  role: Role,
  draft: {
    branchId: number;
    supplierId: number;
    invoiceNumber: string;
    locationId: number;
    shipmentId: number;
  }
): Record<string, string> {
  const w = inventoryWorld();
  return {
    [`scout.receiveShipment.${w.practiceId}.emp-${w.employees[role]}`]: JSON.stringify({
      branchId: draft.branchId,
      supplierId: draft.supplierId,
      invoiceNumber: draft.invoiceNumber,
      defaultLocId: draft.locationId,
      shipmentId: draft.shipmentId,
      parsedLines: [],
      parseMeta: null,
      invoiceFileName: null,
      savedAt: new Date().toISOString(),
    }),
  };
}

/** Re-runs `read` until `ok` holds (stock draws land just after the payment response). */
export function eventually<T>(
  read: () => Cypress.Chainable<T>,
  ok: (value: T) => boolean,
  tries = 10
): Cypress.Chainable<T> {
  return read().then((value) => {
    if (ok(value) || tries <= 1) return cy.wrap(value);
    cy.wait(1000);
    return eventually(read, ok, tries - 1);
  });
}

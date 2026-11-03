/**
 * The seeded EMR world for the euthanasia / visit-payment end-to-end specs (H-EMR).
 *
 * API side: vayd-api test/scripts/emr-e2e-seed.ts, run by the cypress tasks in cypress.config.ts. Set the test
 * database first (it must contain "test", never vayd_api_local; the dev API must use the same one):
 *
 *   EMR_DB=vayd_api_test npx cypress run --spec cypress/e2e/<your-emr-spec>.cy.ts
 *
 *   import { seedEmrWorld, cleanEmrWorld, emrApi, emrStaffHeaders } from '../support/emrWorld';
 *   let world: EmrWorld;
 *   before(() => seedEmrWorld().then((w) => (world = w)));
 *   after(() => cleanEmrWorld());
 *   it('...', () => { cy.visit(world.euthanasia.consentPath); emrApi(world, 'GET', `/visit-estimates/${world.euthanasia.estimateId}`).then(...) });
 *
 * The world: one client (Wren Fairweather, phone + email on the reserved .test domain, so nothing is delivered)
 * with a euthanasia appointment (pet Pippin: 'sent' estimate of 475.00 with the saved card on it, no hold, and an
 * unsigned consent invite token) and an ordinary appointment (pet Juniper: OPEN visit invoice of 150.00 with the
 * saved card on it), plus an eVet Carprofen prescription for Juniper (`evetRx`, EMR-08). The saved card is only the reference pm_card_visa on cus_emr_world: no card was created at
 * Stripe, so a run against real Stripe test mode needs that customer/card created there first.
 */
export type EmrWorld = {
  tag: string;
  practiceId: number;
  client: { id: number; name: string; email: string; phone: string };
  staff: { userId: number; employeeId: number; Authorization: string; token: string };
  savedCard: { customerId: string; paymentMethodId: string; brand: string; last4: string };
  euthanasia: {
    appointmentId: number;
    patientId: number;
    petName: string;
    estimateId: string;
    estimateTotal: number;
    consentInviteId: number;
    consentToken: string;
    /** Public consent form route, with the token. */
    consentPath: string;
  };
  visit: { appointmentId: number; patientId: number; petName: string; invoiceId: string; invoiceTotal: number };
  /**
   * EMR-08: an eVet prescription for Juniper with 3 refills. Like every eVet import it has no pet or item on it;
   * it reaches Juniper only through planItem_Id = her eVet treatment line for `itemName` (a medication).
   */
  evetRx: {
    patientId: number;
    petName: string;
    itemId: number;
    itemName: string;
    prescriptionId: number;
    rxNumber: number;
    instructions: string;
    refills: number;
  };
};

export const seedEmrWorld = (): Cypress.Chainable<EmrWorld> => cy.task<EmrWorld>('seedEmrWorld', null, { timeout: 120000 });

export const cleanEmrWorld = (): Cypress.Chainable<null> => cy.task<null>('cleanEmrWorld', null, { timeout: 120000 });

const apiBase = () =>
  (Cypress.env('API_URL') || Cypress.config('baseUrl')?.replace(':5173', ':3000') || 'http://localhost:3000') as string;

export const emrStaffHeaders = (world: EmrWorld) => ({ Authorization: world.staff.Authorization });

/** Calls the API as the seeded staff login; yields the response. */
export function emrApi(
  world: EmrWorld,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
): Cypress.Chainable<Cypress.Response<any>> {
  return cy.request({
    method,
    url: `${apiBase()}${path}`,
    headers: emrStaffHeaders(world),
    body: body as Cypress.RequestBody,
    failOnStatusCode: false,
  });
}

/**
 * Chooses the checkout's inventory branch and location explicitly, so an open invoice can be paid
 * whatever number of branches/locations the shared test database holds (the pay and Convert buttons
 * stay disabled with "Choose the branch and location inventory is drawn from" until both are set).
 * Picks the location marked "(default)" when there is one, otherwise the first. Call it on the
 * checkout screen before clicking Convert / Pay / Charge.
 */
export function chooseCheckoutInventoryShelf(): void {
  const pickFirstOrDefault = ($select: JQuery<HTMLElement>) => {
    const options = $select.find('option').toArray().filter((o) => (o as HTMLOptionElement).value !== '') as HTMLOptionElement[];
    const preferred = options.find((o) => /\(default\)/.test(o.text)) ?? options[0];
    return preferred.value;
  };
  cy.contains('label', /^\s*Branch/, { timeout: 40000 })
    .find('select')
    .should('not.be.disabled')
    .then(($branch) => {
      if (!$branch.val()) cy.wrap($branch).select(pickFirstOrDefault($branch));
    });
  cy.contains('label', /^\s*Location/)
    .find('select')
    .should('not.be.disabled')
    .should(($loc) => expect($loc.find('option').length, 'location options loaded').to.be.greaterThan(1))
    .then(($loc) => {
      if (!$loc.val()) cy.wrap($loc).select(pickFirstOrDefault($loc));
    });
  cy.contains('label', /^\s*Location/).find('select').should(($loc) => expect($loc.val(), 'location chosen').to.not.eq(''));
}

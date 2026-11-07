/// <reference types="cypress" />
import '../support/e2e';

/**
 * OS-03-6 (vayd-api docs/test-plans/online-store.md): screen to API, a double click on Place order with a slow
 * API makes one order and one charge. The page sends one attempt key per checkout attempt and ignores a second
 * click while the first is placing; the API charges at most once per key and returns the first order to a
 * repeat.
 *
 * Seed: the H-STORE world (cy tasks seedStoreWorld / cleanStoreWorld in cypress.config.ts).
 *   STORE_DB=<test db> CYPRESS_STORE_DB=<same test db> npx cypress run --spec cypress/e2e/os-03-double-click.cy.ts
 * The API the dev server talks to must use the same database, a Stripe TEST key (sk_test / pk_test),
 * EVET_SYNC_ENABLED=false and DISABLE_SCHEDULED_JOBS=true. Not run by the batch that wrote it.
 */
type StoreClient = { clientId: number; email: string; password: string };
type StoreWorld = {
  tag: string;
  items: { storeId: number };
  itemNames: { store: string };
  clientA: StoreClient;
};

const storeDb = () => {
  const name = String(Cypress.env('STORE_DB') || '');
  if (!name || !/test/i.test(name) || /vayd_api_local|prod/i.test(name)) {
    throw new Error(`Set CYPRESS_STORE_DB to the dedicated test database (got "${name}")`);
  }
  return name;
};

const sql = (statement: string): Cypress.Chainable<string> =>
  cy
    .exec(`psql -h localhost -U vayd -d ${storeDb()} -tA -c "$STORE_SQL"`, {
      env: { PGPASSWORD: 'vayd', STORE_SQL: statement },
    })
    .then((r) => r.stdout.trim());

const stripeField = (name: string, value: string) =>
  cy
    .get('.vayd-store__card-box iframe', { timeout: 30000 })
    .its('0.contentDocument.body')
    .should('not.be.empty')
    .then(cy.wrap)
    .find(`input[name="${name}"]`, { timeout: 30000 })
    .clear()
    .type(value);

const enterCard = (number: string) => {
  stripeField('cardnumber', number);
  stripeField('exp-date', '1234');
  stripeField('cvc', '123');
  cy.get('.vayd-store__card-box iframe')
    .its('0.contentDocument.body')
    .then(($body) => {
      if (Cypress.$($body).find('input[name="postal"]').length) stripeField('postal', '53703');
    });
  cy.wait(1500);
};

describe('OS-03-6: a double click places one order, screen to API', () => {
  let w: StoreWorld;

  before(() => {
    cy.task('seedStoreWorld').then((world) => {
      w = world as StoreWorld;
      // The seeded Stripe ids are made up; a real test-mode customer is made on the first card.
      sql(`UPDATE clients SET "stripeCustomerId" = NULL, "savedPaymentMethodId" = NULL WHERE id = ${w.clientA.clientId}`);
    });
  });
  after(() => cy.task('cleanStoreWorld'));

  it('OS-03-6: double-click Place order with a slow API: one checkout request, one order, one charge', () => {
    // Slow API: the reply to checkout is held for 3 seconds, so a second click lands while the first is placing.
    cy.intercept('POST', '**/store/checkout', (req) => {
      req.on('response', (res) => {
        res.setDelay(3000);
      });
    }).as('myCheckout');

    sql(`SELECT count(*) FROM mail_orders WHERE "clientId" = ${w.clientA.clientId}`).then((before) => {
      cy.apiLogin('client', { email: w.clientA.email, password: w.clientA.password, startPath: '/store' });
      cy.window().then((win) => {
        win.localStorage.setItem(
          'vayd_store_cart',
          JSON.stringify([
            {
              inventoryItemId: w.items.storeId,
              name: w.itemNames.store,
              quantity: 1,
              unitPrice: 40,
              autoshipFrequency: null,
              recommendedFrequency: null,
            },
          ]),
        );
      });
      cy.visit('/store/cart');
      cy.contains('Yes — send it here', { timeout: 20000 }).click();
      enterCard('4242424242424242');
      cy.contains('button', 'Place order').dblclick();
      cy.wait('@myCheckout').then(({ request, response }) => {
        expect(response?.statusCode).to.be.lessThan(300);
        expect(String(request.body.attemptKey || '')).to.match(/^[A-Za-z0-9_-]{8,100}$/);
      });
      cy.contains('h1', 'Thank you', { timeout: 30000 });
      cy.get('@myCheckout.all').should('have.length', 1);

      // One order for A, and one PaymentIntent on it.
      sql(`SELECT count(*) FROM mail_orders WHERE "clientId" = ${w.clientA.clientId}`).should('eq', String(Number(before) + 1));
      sql(
        `SELECT count(DISTINCT "stripePaymentId") || '|' || count(*) FROM mail_orders
          WHERE "clientId" = ${w.clientA.clientId} AND created > now() - interval '10 minutes' AND "stripePaymentId" IS NOT NULL`,
      ).should('eq', '1|1');
      sql(
        `SELECT count(*) FROM store_checkout_claims WHERE "clientId" = ${w.clientA.clientId} AND status = 'done'`,
      ).should('eq', '1');
    });
  });
});

/// <reference types="cypress" />
import '../support/e2e';

/**
 * OS-02-6 (vayd-api docs/test-plans/online-store.md, D3): screen to API, a declined card places no order.
 * A portal client places a store order with Stripe's always-declined test card 4000 0000 0000 0002:
 * the cart page shows "Your card was declined. Nothing was charged.", keeps the cart, makes no mail order
 * (so nothing in the Mail Orders list) and sends no email.
 *
 * Seed: the H-STORE world (cy tasks seedStoreWorld / cleanStoreWorld in cypress.config.ts).
 *   STORE_DB=<test db> CYPRESS_STORE_DB=<same test db> [CYPRESS_EMAIL_CAPTURE_PATH=/tmp/store-emails.jsonl] \
 *     npx cypress run --spec cypress/e2e/os-02-declined-card.cy.ts
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

describe('OS-02-6: a declined card places no order, screen to API', () => {
  let w: StoreWorld;

  before(() => {
    cy.task('seedStoreWorld').then((world) => {
      w = world as StoreWorld;
      // The seeded Stripe ids are made up; a real test-mode customer is made on the first card.
      sql(`UPDATE clients SET "stripeCustomerId" = NULL, "savedPaymentMethodId" = NULL WHERE id = ${w.clientA.clientId}`);
    });
  });
  after(() => cy.task('cleanStoreWorld'));

  it('OS-02-6: card 4000 0000 0000 0002 is declined: error on the cart page, no order, no email', () => {
    cy.intercept('POST', '**/store/checkout').as('myCheckout');
    if (Cypress.env('EMAIL_CAPTURE_PATH')) cy.clearCapturedEmails();

    let subsBefore = '';
    sql(`SELECT count(*) FROM online_store_subscriptions WHERE "clientId" = ${w.clientA.clientId}`).then((n) => {
      subsBefore = n;
    });
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
      enterCard('4000000000000002');
      cy.contains('button', 'Place order').click();
      cy.wait('@myCheckout').its('response.statusCode').should('eq', 400);

      cy.get('.vayd-store__place-err').should('contain.text', 'Your card was declined. Nothing was charged.');
      cy.location('pathname').should('eq', '/store/cart');
      cy.contains(w.itemNames.store).should('exist');
      cy.window().then((win) => {
        expect(JSON.parse(win.localStorage.getItem('vayd_store_cart') || '[]')).to.have.length(1);
      });
      // No order for A: the Mail Orders list reads mail_orders.
      sql(`SELECT count(*) FROM mail_orders WHERE "clientId" = ${w.clientA.clientId}`).should('eq', before);
      // No new auto-ship for A (the seed world already has one).
      sql(`SELECT count(*) FROM online_store_subscriptions WHERE "clientId" = ${w.clientA.clientId}`).should(
        'eq',
        subsBefore,
      );
    });
    if (Cypress.env('EMAIL_CAPTURE_PATH')) {
      cy.capturedEmails().then((all) => {
        const toA = (all as Array<{ to?: string | string[] }>).filter((m) =>
          ([] as string[]).concat(m.to ?? []).map((t) => t.toLowerCase()).includes(w.clientA.email.toLowerCase()),
        );
        expect(toA).to.have.length(0);
      });
    }
  });
});

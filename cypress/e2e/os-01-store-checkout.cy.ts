/// <reference types="cypress" />
import '../support/e2e';

/**
 * OS-01-11 (vayd-api docs/test-plans/online-store.md, D1): screen to API, both store checkout paths.
 *   (a) A portal client buys with a saved card: one charge on A's own Stripe customer, the order and the Scout
 *       invoice on A, one thank-you email.
 *   (b) A guest buys a non-prescription item with the Stripe test card 4242: one charge, a guest order (no
 *       client, no invoice), and no saved cards shown or asked for at any point.
 *
 * Seed: the H-STORE world (cy tasks seedStoreWorld / cleanStoreWorld in cypress.config.ts).
 *   STORE_DB=<test db> CYPRESS_STORE_DB=<same test db> [CYPRESS_EMAIL_CAPTURE_PATH=/tmp/store-emails.jsonl] \
 *     npx cypress run --spec cypress/e2e/os-01-store-checkout.cy.ts
 * The API the dev server talks to must use the same database, a Stripe TEST key (sk_test / pk_test),
 * EVET_SYNC_ENABLED=false and DISABLE_SCHEDULED_JOBS=true. chromeWebSecurity is false (cypress.config.ts) so
 * the spec can type into the Stripe card iframe.
 *
 * The seeded Stripe ids (cus_<tag>_a, pm_<tag>_a1) are made up and don't exist at Stripe, so (a) first clears
 * them and saves a real 4242 test card to client A by buying once with "Save my card" ticked; the second
 * purchase is the one with the saved card. The thank-you check needs CYPRESS_EMAIL_CAPTURE_PATH; without it
 * that check is skipped.
 */
type StoreClient = {
  clientId: number;
  patientId: number;
  email: string;
  password: string;
};
type StoreWorld = {
  tag: string;
  practiceId: number;
  items: { storeId: number };
  itemNames: { store: string };
  clientA: StoreClient;
  clientB: StoreClient;
};

const storeDb = () => {
  const name = String(Cypress.env('STORE_DB') || '');
  if (!name || !/test/i.test(name) || /vayd_api_local|prod/i.test(name)) {
    throw new Error(`Set CYPRESS_STORE_DB to the dedicated test database (got "${name}")`);
  }
  return name;
};

/** One SQL statement on the test database; returns the output (one row per line, columns joined by |). */
const sql = (statement: string): Cypress.Chainable<string> =>
  cy
    .exec(`psql -h localhost -U vayd -d ${storeDb()} -tA -c "$STORE_SQL"`, {
      env: { PGPASSWORD: 'vayd', STORE_SQL: statement },
    })
    .then((r) => r.stdout.trim());

/** Types into one field of the store's Stripe card iframe. */
const stripeField = (name: string, value: string) =>
  cy
    .get('.vayd-store__card-box iframe', { timeout: 30000 })
    .its('0.contentDocument.body')
    .should('not.be.empty')
    .then(cy.wrap)
    .find(`input[name="${name}"]`, { timeout: 30000 })
    .clear()
    .type(value);

const enterTestCard = () => {
  stripeField('cardnumber', '4242424242424242');
  stripeField('exp-date', '1234');
  stripeField('cvc', '123');
  cy.get('.vayd-store__card-box iframe')
    .its('0.contentDocument.body')
    .then(($body) => {
      if (Cypress.$($body).find('input[name="postal"]').length) stripeField('postal', '53703');
    });
  cy.wait(1500); // let Stripe report the card complete
};

/** Put one store item in the cart (the cart page reads it from localStorage). */
const cartWithStoreItem = (w: StoreWorld) => {
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
};

const thankYouEmailsTo = (email: string): Cypress.Chainable<unknown[]> =>
  cy.capturedEmails().then((all) =>
    (all as Array<{ to?: string | string[]; subject?: string }>).filter((m) => {
      const to = ([] as string[]).concat(m.to ?? []).map((t) => t.toLowerCase());
      return to.includes(email.toLowerCase()) && /thank/i.test(String(m.subject ?? ''));
    }),
  );

describe('OS-01-11: store checkout, screen to API', () => {
  let w: StoreWorld;

  before(() => {
    cy.task('seedStoreWorld').then((world) => {
      w = world as StoreWorld;
      // Made-up Stripe ids would fail at Stripe test mode; client A saves a real test card in (a).
      sql(`UPDATE clients SET "stripeCustomerId" = NULL, "savedPaymentMethodId" = NULL WHERE id = ${w.clientA.clientId}`);
    });
  });

  after(() => {
    if (w) {
      // Guest orders belong to no client, so the world clean-up can't find them.
      sql(
        `DELETE FROM mail_order_lines WHERE "mailOrderId" IN (SELECT id FROM mail_orders WHERE "customerName" LIKE '${w.tag}%' AND "clientId" IS NULL)`,
      );
      sql(`DELETE FROM mail_orders WHERE "customerName" LIKE '${w.tag}%' AND "clientId" IS NULL`);
    }
    cy.task('cleanStoreWorld');
  });

  it('OS-01-11 (a): a portal client buys with a saved card; one charge on A, order and invoice on A, one thank-you', () => {
    cy.intercept('POST', '**/public/store/card-on-file').as('typedEmailCards');
    cy.intercept('GET', '**/store/checkout/cards').as('myCards');
    cy.intercept('POST', '**/store/checkout').as('myCheckout');

    cy.apiLogin('client', { email: w.clientA.email, password: w.clientA.password, startPath: '/store' });

    // First purchase: A has no card yet; enter 4242 and keep "Save my card" ticked.
    cartWithStoreItem(w);
    cy.visit('/store/cart');
    cy.wait('@myCards').its('response.body.cards').should('have.length', 0);
    cy.contains('Yes — send it here', { timeout: 20000 }).click();
    cy.get('.vayd-store__card-save input[type="checkbox"]').should('be.checked');
    enterTestCard();
    cy.contains('button', 'Place order').click();
    cy.wait('@myCheckout').its('response.statusCode').should('be.lessThan', 300);
    cy.contains('h1', 'Thank you', { timeout: 30000 });
    sql(`SELECT "stripeCustomerId" || '|' || "savedPaymentMethodId" FROM clients WHERE id = ${w.clientA.clientId}`).should(
      'match',
      /^cus_\w+\|pm_\w+$/,
    );

    // Second purchase: with the saved card, from A's own list.
    if (Cypress.env('EMAIL_CAPTURE_PATH')) cy.clearCapturedEmails();
    cartWithStoreItem(w);
    cy.visit('/store/cart');
    cy.wait('@myCards').then(({ response }) => {
      const cards = (response?.body?.cards ?? []) as Array<{ paymentMethodId: string; last4: string }>;
      expect(cards).to.have.length(1);
      expect(cards[0].last4).to.eq('4242');
      cy.get('.vayd-store__card-select', { timeout: 20000 }).should('contain.text', '4242');
      // Typing someone else's email changes nothing.
      cy.contains('label', 'Email').find('input').clear().type(w.clientB.email);
      cy.get('.vayd-store__card-select option').should('have.length', 1);
      cy.contains('button', 'Place order').click();
      cy.wait('@myCheckout').then(({ request, response }) => {
        expect(response?.statusCode).to.be.lessThan(300);
        expect(request.body.paymentMethodId).to.eq(cards[0].paymentMethodId);
        expect(request.body).not.to.have.property('clientId');
        const orderId = Number(response?.body?.id);
        sql(
          `SELECT o."clientId" || '|' || o."paymentStatus" || '|' || o."stripePaymentId" || '|' || v."clientId" || '|' || v.status || '|' || v."stripePaymentIntentId"
             FROM mail_orders o JOIN visit_invoices v ON v.id = o."scoutInvoiceId" WHERE o.id = ${orderId}`,
        ).then((row) => {
          const [orderClient, paid, pi, invoiceClient, invoiceStatus, invoicePi] = row.split('|');
          expect(Number(orderClient)).to.eq(w.clientA.clientId);
          expect(paid).to.eq('paid');
          expect(pi).to.match(/^pi_/);
          expect(Number(invoiceClient)).to.eq(w.clientA.clientId);
          expect(invoiceStatus).to.eq('paid');
          expect(invoicePi).to.eq(pi);
        });
        // One charge for this order: no other order of A's carries the same PaymentIntent.
        sql(
          `SELECT count(*) FROM mail_orders WHERE "stripePaymentId" = (SELECT "stripePaymentId" FROM mail_orders WHERE id = ${orderId})`,
        ).should('eq', '1');
      });
    });
    cy.contains('h1', 'Thank you', { timeout: 30000 });
    if (Cypress.env('EMAIL_CAPTURE_PATH')) {
      thankYouEmailsTo(w.clientA.email).should('have.length', 1);
    }
    cy.get('@typedEmailCards.all').should('have.length', 0);
  });

  it('OS-01-11 (b): a guest buys with the 4242 test card; one charge, a guest order, no saved cards at any point', () => {
    cy.intercept('POST', '**/public/store/card-on-file').as('typedEmailCards');
    cy.intercept('GET', '**/store/checkout/cards').as('myCards');
    cy.intercept('POST', '**/public/store/checkout').as('guestCheckout');

    cy.clearLocalStorage();
    cy.visit('/store');
    cartWithStoreItem(w);
    cy.visit('/store/cart');
    cy.contains('Checking out as a guest', { timeout: 20000 });
    cy.get('.vayd-store__card-select').should('not.exist');

    cy.contains('label', 'Name').find('input').type(`${w.tag} Guest`);
    // Client B's email (B has a household card): a guest still sees no saved card.
    cy.contains('label', 'Email').find('input').type(w.clientB.email);
    cy.get('.vayd-store__po-box input[type="checkbox"]').check();
    cy.get('input[placeholder="PO Box 123 or street address"]').type('PO Box 77');
    cy.get('input[placeholder="City"]').type('Madison');
    cy.get('input[placeholder="State"]').type('WI');
    cy.get('input[placeholder="Zip"]').type('53703');
    cy.get('.vayd-store__card-select').should('not.exist');
    enterTestCard();
    cy.contains('button', 'Place order').click();
    cy.wait('@guestCheckout').then(({ request, response }) => {
      expect(response?.statusCode).to.be.lessThan(300);
      expect(request.body.saveCard).to.eq(false);
      expect(request.body).not.to.have.property('clientId');
      const orderId = Number(response?.body?.id);
      sql(
        `SELECT coalesce("clientId"::text, 'none') || '|' || "paymentStatus" || '|' || coalesce("stripePaymentId", '') || '|' || coalesce("scoutInvoiceId"::text, 'none')
           FROM mail_orders WHERE id = ${orderId}`,
      ).then((row) => {
        const [client, paid, pi, invoice] = row.split('|');
        expect(client).to.eq('none');
        expect(paid).to.eq('paid');
        expect(pi).to.match(/^pi_/);
        expect(invoice).to.eq('none');
      });
      sql(`SELECT count(*) FROM mail_orders WHERE "stripePaymentId" = (SELECT "stripePaymentId" FROM mail_orders WHERE id = ${orderId})`).should(
        'eq',
        '1',
      );
    });
    cy.contains('h1', 'Thank you', { timeout: 30000 });
    // B's card on file was not touched by the guest's purchase.
    sql(`SELECT coalesce("savedPaymentMethodId", '') FROM clients WHERE id = ${w.clientB.clientId}`).should(
      'match',
      /^pm_store/,
    );
    cy.get('@typedEmailCards.all').should('have.length', 0);
    cy.get('@myCards.all').should('have.length', 0);
  });
});

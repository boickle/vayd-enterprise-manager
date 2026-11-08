/// <reference types="cypress" />
import '../support/e2e';

/**
 * OS-06-4 (vayd-api docs/test-plans/online-store.md): screen to API, an old eVet bill paid in the portal is
 * recorded. Client A (H-STORE seed) has an open $85 eVet invoice. A pays it in the client portal with the Stripe
 * test card 4242: the bill is gone from the portal, a payment row (Stripe PaymentIntent, eVet invoice number)
 * is linked to the bill, and the staff Billing tab (client page, Financial) shows the payment.
 *
 * Seed: the H-STORE world (cy tasks seedStoreWorld / cleanStoreWorld in cypress.config.ts).
 *   STORE_DB=<test db> CYPRESS_STORE_DB=<same test db> npx cypress run --spec cypress/e2e/os-06-evet-portal-payment.cy.ts
 * The API the dev server talks to must use the same database, a Stripe TEST key, EVET_SYNC_ENABLED=false (eVet
 * bills can only be paid online with eVet sync off) and DISABLE_SCHEDULED_JOBS=true. The staff Billing tab
 * check needs CYPRESS_EMPLOYEE_EMAIL / CYPRESS_EMPLOYEE_PASSWORD for a staff login on the same database;
 * without them that part is skipped. Not run by the batch that wrote it.
 */
type StoreClient = { clientId: number; email: string; password: string };
type StoreWorld = {
  tag: string;
  clientA: StoreClient;
  evetInvoice: { invoiceId: number; clientId: number; total: number };
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

/** Fill the card form's billing address when the page has not filled it from the address on file. */
const fillBillingIfEmpty = () => {
  const fields: Array<[string, string]> = [
    ['billing address-line1', '12 Fixture Lane'],
    ['billing address-level2', 'Madison'],
    ['billing address-level1', 'WI'],
    ['billing postal-code', '53703'],
  ];
  for (const [ac, value] of fields) {
    cy.get(`input[autocomplete="${ac}"]`).then(($el) => {
      if (!String($el.val() ?? '').trim()) cy.wrap($el).type(value);
    });
  }
};

const enterCard = (number: string) => {
  stripeField('cardnumber', number);
  stripeField('exp-date', '1234');
  stripeField('cvc', '123');
  cy.get('.vayd-store__card-box iframe')
    .its('0.contentDocument.body')
    .then(($body) => {
      if (Cypress.$($body).find('input[name="postal"]').length) stripeField('postal', '53703');
    });
  fillBillingIfEmpty();
  cy.wait(1500);
};

describe('OS-06-4: an eVet bill paid in the portal is recorded, screen to API', () => {
  let w: StoreWorld;

  before(() => {
    cy.task('seedStoreWorld').then((world) => {
      w = world as StoreWorld;
      sql(
        `UPDATE clients SET "stripeCustomerId" = NULL, "savedPaymentMethodId" = NULL WHERE id = ${w.clientA.clientId}`
      );
    });
  });
  after(() => {
    if (w) {
      sql(`DELETE FROM payments WHERE "clientId" = ${w.clientA.clientId}`);
    }
    cy.task('cleanStoreWorld');
  });

  it('OS-06-4: pay the $85 eVet bill in the portal: bill gone, payment recorded, Billing tab shows it', () => {
    cy.intercept('POST', '**/store/checkout/pay-balance').as('payBalance');
    cy.apiLogin('client', {
      email: w.clientA.email,
      password: w.clientA.password,
      startPath: '/client-portal',
    });

    cy.contains('Your balance: $85.00', { timeout: 30000 });
    cy.contains('button', 'Pay now').click();
    enterCard('4242424242424242');
    cy.contains('button', 'Pay $85.00').click();
    cy.wait('@payBalance').then(({ request, response }) => {
      expect(response?.statusCode).to.be.lessThan(300);
      expect(String(request.body.attemptKey || '')).to.match(/^[A-Za-z0-9_-]{8,100}$/);
      expect(Number(response?.body?.paid)).to.eq(85);
    });
    cy.contains('Paid $85.00', { timeout: 30000 });

    // Bill gone from the portal.
    cy.reload();
    cy.contains('Your balance: $85.00').should('not.exist');

    // The eVet bill is paid and the payment is recorded against it.
    sql(
      `SELECT "amountPaid"::numeric(10,2) || '|' || "invoiceStatusValue" || '|' || ("externalUpdated" IS NOT NULL)
         FROM invoices WHERE id = ${w.evetInvoice.invoiceId}`
    ).should('eq', '85.00|3|true');
    sql(
      `SELECT p.amount::numeric(10,2) || '|' || p."transactionID" || '|' || p."paymentTypeName" || '|' || ip."invoiceId"
         FROM payments p JOIN invoice_payments ip ON ip."paymentId" = p.id
        WHERE p."clientId" = ${w.clientA.clientId} AND p."isVoided" = false`
    ).then((row) => {
      const [amount, pi, type, invoiceId] = row.split('|');
      expect(amount).to.eq('85.00');
      expect(pi).to.match(/^pi_/);
      expect(type).to.eq('Card (client portal)');
      expect(Number(invoiceId)).to.eq(w.evetInvoice.invoiceId);
    });

    // Staff Billing tab (client page, Financial) shows the payment.
    if (Cypress.env('EMPLOYEE_EMAIL')) {
      cy.clearLocalStorage();
      cy.apiLogin('employee', {
        startPath: `/schedule/clients?clientId=${w.clientA.clientId}&tab=financial`,
      });
      cy.get('#client-financial', { timeout: 30000 }).should(
        'contain.text',
        'Card (client portal)'
      );
      cy.get('#client-financial').should('contain.text', '85.00');
    }
  });
});

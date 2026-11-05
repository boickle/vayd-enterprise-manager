/// <reference types="cypress" />

/**
 * PAY-01-6: the real membership signup still works after PAY-01 (the public checkout takes
 * membership signups only, never uses a customer id from the browser, never finds a Stripe
 * customer by the typed email). docs/test-plans/invoicing-and-payments.md in vayd-api.
 *
 * A portal client opens the client portal, explores plans for their active dog, chooses
 * Foundations (monthly), signs the agreement, enters a card and pays. Expect: the success screen,
 * one Stripe subscription on a new customer for that household, the Scout membership active, and
 * one welcome email captured (re-addressed to deirdre@vetatyourdoor.com).
 *
 * Offline by design: nothing reaches real Stripe.
 * - Browser: Stripe.js is replaced by a small fake (window.Stripe, installed before the app loads).
 *   Its card field takes 4242 4242 4242 4242 and createPaymentMethod returns pm_pay01_e2e_visa.
 * - API: started with STRIPE_API_BASE on vayd-api's test/scripts/e2e-fake-stripe.js, which records
 *   every request to STRIPE_LOG and serves the seeded plan prices (FAKE_STRIPE_PRICES).
 * Everything between (signup page, MembershipPayment, POST /stripe/payment-processing/payments,
 * plan pinning, household checks, Stripe customer/subscription calls, Scout enrollment, emails) is real.
 *
 * Seed with vayd-api's test/scripts/pay-01-e2e-seed.ts; env: CYPRESS_PAY01_WORLD (the world JSON),
 * CYPRESS_STRIPE_LOG, CYPRESS_EMAIL_CAPTURE_PATH, CYPRESS_E2E_DB (the API's test database).
 */

type Pay01World = {
  tag: string;
  practiceId: number;
  clientId: number;
  email: string;
  patientId: number;
  petName: string;
  priceMonthly: string;
  priceAnnual: string;
  auth: { Authorization: string; token: string };
};

const FAKE_PM = 'pm_pay01_e2e_visa';
const TEST_INBOX = 'deirdre@vetatyourdoor.com';

function world(): Pay01World {
  const raw = Cypress.env('PAY01_WORLD') as string | Pay01World | undefined;
  if (!raw) throw new Error('Set CYPRESS_PAY01_WORLD to the JSON from pay-01-e2e-seed.ts');
  return typeof raw === 'string' ? (JSON.parse(raw) as Pay01World) : raw;
}

const jsonLines = (text: string) =>
  text
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));

function sql(statement: string): Cypress.Chainable<string> {
  const db = String(Cypress.env('E2E_DB') || '');
  if (!/test/i.test(db) || /vayd_api_local|prod/i.test(db)) {
    throw new Error(`Refusing: CYPRESS_E2E_DB "${db}" is not a dedicated test database`);
  }
  return cy
    .exec('psql -h localhost -U vayd -d ' + db + ' -tA -c "$PAY01_SQL"', {
      env: { PGPASSWORD: 'vayd', PAY01_SQL: statement },
    })
    .then((r) => r.stdout.trim().split('\n')[0] ?? '');
}

/** A stand-in for Stripe.js: one card field, and a payment method id for whatever card is typed. */
function installFakeStripeJs(win: Cypress.AUTWindow) {
  const record: Array<Record<string, unknown>> = [];
  (win as any).__fakeStripeJs = record;
  (win as any).Stripe = function FakeStripe(publishableKey: string) {
    let input: HTMLInputElement | null = null;
    const card = {
      mount(target: string | HTMLElement) {
        const el = typeof target === 'string' ? win.document.querySelector(target) : target;
        input = win.document.createElement('input');
        input.name = 'cardnumber';
        input.placeholder = 'Card number';
        input.setAttribute('data-fake-stripe-card', '');
        el?.appendChild(input);
      },
      on() {},
      off() {},
      update() {},
      focus() {},
      blur() {},
      clear() {
        if (input) input.value = '';
      },
      unmount() {
        input?.remove();
      },
      destroy() {
        input?.remove();
      },
    };
    return {
      elements: () => ({ create: () => card, getElement: () => card }),
      async createPaymentMethod(opts: Record<string, unknown>) {
        const digits = (input?.value ?? '').replace(/\D/g, '');
        record.push({ call: 'createPaymentMethod', publishableKey, digits, billing: opts.billing_details });
        if (digits !== '4242424242424242') {
          return { error: { type: 'card_error', message: 'Your card number is incorrect.' } };
        }
        return { paymentMethod: { id: FAKE_PM, type: 'card', card: { brand: 'visa', last4: '4242' } } };
      },
      async confirmCardPayment() {
        record.push({ call: 'confirmCardPayment' });
        return { paymentIntent: { status: 'succeeded' } };
      },
    };
  };
}

describe('PAY-01-6: a real membership signup still works', () => {
  it('portal client signs an active dog up: success screen, one Stripe subscription, Scout membership active, one welcome email', () => {
    const w = world();
    const stripeLog = Cypress.env('STRIPE_LOG') as string;
    const mailLog = Cypress.env('EMAIL_CAPTURE_PATH') as string;
    expect(stripeLog, 'CYPRESS_STRIPE_LOG').to.be.a('string');
    expect(mailLog, 'CYPRESS_EMAIL_CAPTURE_PATH').to.be.a('string');

    // Before: no Scout membership, no Stripe customer on the household.
    sql(`SELECT count(*) FROM wellness_plans WHERE "patientId" = ${w.patientId} AND NOT "isDeleted"`).then((n) =>
      expect(n).to.eq('0'),
    );
    sql(`SELECT coalesce("stripeCustomerId", '') FROM clients WHERE id = ${w.clientId}`).then((v) => expect(v).to.eq(''));
    cy.readFile(stripeLog).then((t: string) => cy.wrap(jsonLines(t).length).as('stripeBefore'));
    cy.readFile(mailLog).then((t: string) => cy.wrap(jsonLines(t).length).as('mailBefore'));

    // Offline: never load the real Stripe.js. The key only has to be present for the page to build its card form.
    cy.intercept('https://js.stripe.com/**', { statusCode: 200, body: '' });
    cy.intercept('GET', '**/practice/public-config', (req) => {
      req.continue((res) => {
        res.body = { ...res.body, stripePublishableKey: res.body?.stripePublishableKey || 'pk_test_pay01_fake' };
      });
    });
    cy.intercept('POST', '**/stripe/payment-processing/payments').as('checkout');

    // Signed in as the seeded portal client (a minted token, like the other seeded worlds).
    cy.visit('/login');
    cy.window().then((win) => {
      win.localStorage.clear();
      win.localStorage.setItem('accessToken', w.auth.token);
      win.localStorage.setItem('vayd_clientId', String(w.clientId));
    });
    cy.visit('/client-portal', { onBeforeLoad: installFakeStripeJs });

    cy.contains('button', `Explore plans for ${w.petName}`, { timeout: 30000 }).scrollIntoView().click();
    cy.contains('h3', /Foundations/, { timeout: 30000 })
      .closest('article')
      .within(() => {
        cy.contains('button', 'Add to Cart').click();
      });
    cy.get('body').then(($b) => {
      if ($b.find('.cp-billing-toggle').length) {
        cy.get('.cp-billing-toggle').contains('button', 'Monthly').click();
      }
    });
    cy.contains('label', /I have read and agree/).find('input[type="checkbox"]').check();
    cy.get('input[placeholder="Type your full name"]').type('Pia Signupowner');
    cy.contains('button', 'Continue to Payment').should('not.be.disabled').click();

    // MembershipPayment
    cy.get('input[placeholder="Full name on card"]', { timeout: 30000 });
    cy.get('body').then(($b) => {
      // The email box only shows when there is no address for the client.
      if ($b.find('input[placeholder="you@example.com"]').length) {
        cy.get('input[placeholder="you@example.com"]').clear().type(w.email);
      }
    });
    cy.get('input[placeholder="Full name on card"]').type('Pia Signupowner');
    cy.get('input[placeholder="Address line 1"]').type('1 Test St');
    cy.get('input[placeholder="City"]').type('Portland');
    cy.get('input[placeholder="State"]').type('ME');
    cy.get('input[placeholder="Postal Code"]').type('04101');
    cy.get('#card-container [data-fake-stripe-card]', { timeout: 30000 }).type('4242424242424242');
    cy.contains('button', /Pay & Enroll/i).should('not.be.disabled').click();

    // The browser sent a membership signup for this household and pet, and no customer id.
    cy.wait('@checkout', { timeout: 60000 }).then(({ request, response }) => {
      expect(response?.statusCode, 'checkout status').to.eq(201);
      expect(response?.body?.success, 'checkout success').to.eq(true);
      expect(request.body.membershipTransaction, 'membershipTransaction').to.be.an('object');
      expect(Number(request.body.membershipTransaction.clientId)).to.eq(w.clientId);
      expect(Number(request.body.membershipTransaction.patientId)).to.eq(w.patientId);
      expect(request.body.sourceId).to.eq(FAKE_PM);
      expect(request.body.subscriptionPlanVariationId).to.eq(w.priceMonthly);
    });

    // Success screen
    cy.contains('h1', 'Payment Successful', { timeout: 30000 });
    cy.contains(`${w.petName} is now enrolled`);

    // Fake Stripe: one new customer, the card attached and made default on it, one subscription on it
    // at the plan's monthly price, and no customer looked up by email.
    cy.get<number>('@stripeBefore').then((before) => {
      cy.readFile(stripeLog).then((t: string) => {
        const fresh = jsonLines(t).slice(before) as Array<{ method: string; url: string; body: string }>;
        const path = (u: string) => u.split('?')[0];
        expect(fresh.filter((r) => path(r.url) === '/v1/customers/search'), 'customer searches').to.have.length(0);
        const customers = fresh.filter((r) => r.method === 'POST' && path(r.url) === '/v1/customers');
        expect(customers, 'new Stripe customers').to.have.length(1);
        const subs = fresh.filter((r) => r.method === 'POST' && path(r.url) === '/v1/subscriptions');
        expect(subs, 'Stripe subscriptions created').to.have.length(1);
        const form = new URLSearchParams(subs[0].body);
        const customer = form.get('customer') ?? '';
        expect(customer).to.match(/^cus_fake_/);
        expect(form.get('items[0][price]')).to.eq(w.priceMonthly);
        expect(form.get('default_payment_method')).to.eq(FAKE_PM);
        const attach = fresh.filter((r) => r.method === 'POST' && r.url === `/v1/payment_methods/${FAKE_PM}/attach`);
        expect(attach, 'card attached once').to.have.length(1);
        expect(new URLSearchParams(attach[0].body).get('customer')).to.eq(customer);
        expect(fresh.filter((r) => r.method === 'POST' && /^\/v1\/payment_intents/.test(path(r.url))), 'one-off charges').to.have.length(0);
        cy.wrap(customer).as('customer');
      });
    });

    // Scout: the household is linked to that customer and the pet has one active membership on that subscription.
    cy.get<string>('@customer').then((customer) => {
      sql(`SELECT "stripeCustomerId" FROM clients WHERE id = ${w.clientId}`).then((v) => expect(v).to.eq(customer));
    });
    sql(
      `SELECT count(*) FROM wellness_plans WHERE "patientId" = ${w.patientId} AND NOT "isDeleted" AND "isActive"
         AND "wellnessPlanStatusValue" <> 0 AND "stripeSubscriptionId" LIKE 'sub_fake_%'`,
    ).then((n) => expect(n, 'active Scout memberships').to.eq('1'));

    // One welcome email, captured and only to the test inbox.
    cy.get<number>('@mailBefore').then((before) => {
      cy.readFile(mailLog).then((t: string) => {
        const fresh = jsonLines(t).slice(before) as Array<{ to?: string | string[]; subject?: string }>;
        const welcome = fresh.filter((m) => String(m.subject ?? '').includes(`Welcome to VAYD Membership - ${w.petName}`));
        expect(welcome, 'welcome emails').to.have.length(1);
        for (const m of fresh) {
          expect([].concat((m.to ?? []) as never), `recipients of "${m.subject}"`).to.deep.eq([TEST_INBOX]);
        }
      });
    });
  });
});

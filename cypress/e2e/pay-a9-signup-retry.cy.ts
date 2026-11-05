/// <reference types="cypress" />

/**
 * PAY-A9-2: a membership signup paid again after the reply was lost starts one subscription.
 * docs/test-plans/invoicing-and-payments.md in vayd-api.
 *
 * A portal client signs their active dog up (same world as PAY-01-6). The first Pay reaches the
 * API and is carried out, but the browser never gets the reply (the connection is cut on the way
 * back). The page shows an error; the client fills the form in again and clicks Pay again.
 * Expect: the success screen, ONE Stripe subscription, the retry sent with the SAME idempotency key
 * as the first try, one active Scout membership and one welcome email.
 *
 * The plan says "Stripe test mode"; our rule is never to call Stripe, so this runs offline like
 * pay-01-membership-signup.cy.ts:
 * - Browser: Stripe.js is replaced by a small fake (window.Stripe, installed before the app loads).
 * - API: started with STRIPE_API_BASE on vayd-api's test/scripts/e2e-fake-stripe.js (records every
 *   request to STRIPE_LOG, serves the seeded plan prices from FAKE_STRIPE_PRICES).
 * - The reply is cut with cy.intercept: the first POST /stripe/payment-processing/payments goes on
 *   to the API (req.continue), and its response is replaced with a network error
 *   (res.send({ forceNetworkError: true })), so the server finished the signup but the page saw a
 *   dropped connection. If a Cypress version ignores forceNetworkError in the response phase, the
 *   "first reply was cut" assertion below fails loudly instead of passing for the wrong reason.
 *
 * Seed with vayd-api's test/scripts/pay-01-e2e-seed.ts (a fresh world per run); env:
 * CYPRESS_PAY01_WORLD (the world JSON), CYPRESS_STRIPE_LOG, CYPRESS_EMAIL_CAPTURE_PATH,
 * CYPRESS_E2E_DB (the API's test database).
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

const FAKE_PM = 'pm_paya9_e2e_visa';
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
    .exec('psql -h localhost -U vayd -d ' + db + ' -tA -c "$PAYA9_SQL"', {
      env: { PGPASSWORD: 'vayd', PAYA9_SQL: statement },
    })
    .then((r) => r.stdout.trim().split('\n')[0] ?? '');
}

/** A stand-in for Stripe.js: one card field, and a payment method id for whatever card is typed. */
function installFakeStripeJs(win: Cypress.AUTWindow) {
  let made = 0;
  (win as any).Stripe = function FakeStripe() {
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
      async createPaymentMethod() {
        const digits = (input?.value ?? '').replace(/\D/g, '');
        if (digits !== '4242424242424242') {
          return { error: { type: 'card_error', message: 'Your card number is incorrect.' } };
        }
        // Like Stripe.js, each Pay makes a new payment method.
        made += 1;
        return { paymentMethod: { id: `${FAKE_PM}_${made}`, type: 'card', card: { brand: 'visa', last4: '4242' } } };
      },
      async confirmCardPayment() {
        return { paymentIntent: { status: 'succeeded' } };
      },
    };
  };
}

function fillPaymentForm(email: string) {
  cy.get('input[placeholder="Full name on card"]', { timeout: 30000 });
  cy.get('body').then(($b) => {
    if ($b.find('input[placeholder="you@example.com"]').length) {
      cy.get('input[placeholder="you@example.com"]').clear().type(email);
    }
  });
  cy.get('input[placeholder="Full name on card"]').clear().type('Pia Signupowner');
  cy.get('input[placeholder="Address line 1"]').clear().type('1 Test St');
  cy.get('input[placeholder="City"]').clear().type('Portland');
  cy.get('input[placeholder="State"]').clear().type('ME');
  cy.get('input[placeholder="Postal Code"]').clear().type('04101');
  cy.get('#card-container [data-fake-stripe-card]', { timeout: 30000 }).clear().type('4242424242424242');
}

describe('PAY-A9-2: paying again after the reply was cut starts one subscription', () => {
  it('first Pay is carried out but its reply is lost; second Pay shows success with one subscription', () => {
    const w = world();
    const stripeLog = Cypress.env('STRIPE_LOG') as string;
    const mailLog = Cypress.env('EMAIL_CAPTURE_PATH') as string;
    expect(stripeLog, 'CYPRESS_STRIPE_LOG').to.be.a('string');
    expect(mailLog, 'CYPRESS_EMAIL_CAPTURE_PATH').to.be.a('string');

    sql(`SELECT count(*) FROM wellness_plans WHERE "patientId" = ${w.patientId} AND NOT "isDeleted"`).then((n) =>
      expect(n, 'memberships before').to.eq('0'),
    );
    cy.readFile(stripeLog).then((t: string) => cy.wrap(jsonLines(t).length).as('stripeBefore'));
    cy.readFile(mailLog).then((t: string) => cy.wrap(jsonLines(t).length).as('mailBefore'));

    cy.intercept('https://js.stripe.com/**', { statusCode: 200, body: '' });
    cy.intercept('GET', '**/practice/public-config', (req) => {
      req.continue((res) => {
        res.body = { ...res.body, stripePublishableKey: res.body?.stripePublishableKey || 'pk_test_paya9_fake' };
      });
    });

    // The first checkout reaches the API; the reply is cut on its way back to the browser.
    let checkoutCalls = 0;
    const sentKeys: string[] = [];
    cy.intercept('POST', '**/stripe/payment-processing/payments', (req) => {
      checkoutCalls += 1;
      sentKeys.push(String(req.body?.idempotencyKey ?? ''));
      if (checkoutCalls === 1) {
        req.continue((res) => {
          res.send({ forceNetworkError: true });
        });
      } else {
        req.continue();
      }
    }).as('checkout');

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

    // First Pay: the API does the signup, the page sees a dropped connection.
    fillPaymentForm(w.email);
    cy.contains('button', /Pay & Enroll/i).should('not.be.disabled').click();
    cy.wait('@checkout', { timeout: 60000 });
    cy.contains('h1', 'Payment Successful').should('not.exist');
    cy.contains('button', /Pay & Enroll/i, { timeout: 30000 }).should('not.be.disabled');

    // The first reply was cut AFTER the API did the work: one subscription already exists.
    cy.get<number>('@stripeBefore').then((before) => {
      cy.readFile(stripeLog).then((t: string) => {
        const fresh = jsonLines(t).slice(before) as Array<{ method: string; url: string }>;
        const subs = fresh.filter((r) => r.method === 'POST' && r.url.split('?')[0] === '/v1/subscriptions');
        expect(subs, 'subscriptions after the cut reply (the first try reached Stripe)').to.have.length(1);
      });
    });

    // Second Pay from the same page.
    fillPaymentForm(w.email);
    cy.contains('button', /Pay & Enroll/i).should('not.be.disabled').click();
    cy.wait('@checkout', { timeout: 60000 }).then(({ response }) => {
      expect(response?.statusCode, 'second checkout status').to.eq(201);
      expect(response?.body?.success, 'second checkout success').to.eq(true);
    });
    cy.contains('h1', 'Payment Successful', { timeout: 30000 });
    cy.contains(`${w.petName} is now enrolled`);

    cy.then(() => {
      expect(checkoutCalls, 'checkout posts').to.eq(2);
      expect(sentKeys[0], 'first key').to.match(/\S/);
      expect(sentKeys[1], 'the retry reuses the first attempt key').to.eq(sentKeys[0]);
    });

    // One subscription in fake Stripe, one active Scout membership, one welcome email.
    cy.get<number>('@stripeBefore').then((before) => {
      cy.readFile(stripeLog).then((t: string) => {
        const fresh = jsonLines(t).slice(before) as Array<{ method: string; url: string }>;
        const subs = fresh.filter((r) => r.method === 'POST' && r.url.split('?')[0] === '/v1/subscriptions');
        expect(subs, 'Stripe subscriptions created').to.have.length(1);
      });
    });
    sql(
      `SELECT count(*) FROM wellness_plans WHERE "patientId" = ${w.patientId} AND NOT "isDeleted" AND "isActive"
         AND "wellnessPlanStatusValue" <> 0`,
    ).then((n) => expect(n, 'active Scout memberships').to.eq('1'));
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

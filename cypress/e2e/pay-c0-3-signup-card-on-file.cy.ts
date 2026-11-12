/// <reference types="cypress" />
import '../support/e2e';
import { emrApi, emrSql, emrWorld, signInEmr, soapPath, type EmrHousehold } from '../support/emrCoreVisitWorld';

/**
 * PAY-C0-3 (docs/test-plans/invoicing-and-payments.md in vayd-api, section 4 "PAY-C0"): a portal client
 * with NO card on file signs a dog up for a membership with card 4242; staff then open checkout for the
 * dog's visit, and checkout offers "Card on file · Visa •4242" with no re-consent note.
 * Since Nov 10 a membership signup card becomes the card on file when the client has none
 * (saveMembershipCardIfNone in vayd-api src/clients/client-stripe.service.ts, called from
 * paymentProcessing.service.ts). Since PAY-C7 the signup page offers a saved card; this client has none,
 * so the page shows no saved-card choice and they type the card.
 *
 * Offline by design (as pay-01-membership-signup.cy.ts): nothing reaches real Stripe.
 * - Browser: Stripe.js is replaced by a small fake; its card field takes 4242 4242 4242 4242 and
 *   createPaymentMethod returns pm_payc03_e2e_visa.
 * - API: STRIPE_API_BASE on vayd-api's test/scripts/e2e-fake-stripe.js. It records every request in
 *   STRIPE_LOG, serves the seeded plan prices (FAKE_STRIPE_PRICES), and answers
 *   GET /v1/payment_methods/pm_... with a Visa ending 4242 that has not expired, which is what visit
 *   checkout reads for the card on file. The checkout card is NOT stubbed in the browser.
 * The card is never charged here (PAY-C0-2 covers the charge at the backend level).
 *
 * How to run (API port 3210, web port 5190; a test database, never vayd_api_local):
 *
 *   S=/tmp/payc03; mkdir -p $S; : > $S/stripe.jsonl; : > $S/mail.jsonl
 *   # 1. Seed (vayd-api checkout)
 *   cd <vayd-api> && DB_DATABASE=vayd_api_test_cards_b NODE_OPTIONS=--no-experimental-strip-types \
 *     npx ts-node -T test/scripts/pay-c0-3-e2e-seed.ts seed vayd_api_test_cards_b $S/world.json $S/prices.json
 *   # 2. Fake Stripe
 *   PORT=4210 STRIPE_LOG=$S/stripe.jsonl FAKE_STRIPE_PRICES=$S/prices.json node test/scripts/e2e-fake-stripe.js &
 *   # 3. API (built: npm run build), on the same database, every outbound service off or captured
 *   PORT=3210 DB_DATABASE=vayd_api_test_cards_b \
 *     MIGRATION_DB_NAME=vayd_api_test_cards_b MIGRATION_DB_DATABASE=vayd_api_test_cards_b \
 *     STRIPE_API_BASE=http://127.0.0.1:4210 STRIPE_SECRET_KEY=sk_test_fake_payc03 \
 *     CONTROL_DB_ENABLED=false GMAIL_POLL_INTERVAL_MS=0 DISABLE_SCHEDULED_JOBS=true EVET_SYNC_ENABLED=false \
 *     EMAIL_REDIRECT=deirdre@vetatyourdoor.com E2E_API_DIR=<vayd-api> EMAIL_CAPTURE_PATH=$S/mail.jsonl \
 *     ANTHROPIC_API_KEY= OPENAI_API_KEY= SOCKET_REDIS_ADAPTER=off REDIS_URL=redis://127.0.0.1:6379/<free db> \
 *     NODE_OPTIONS="--require <vayd-api>/test/scripts/e2e-capture-preload.js" node dist/main.js
 *   # 4. Web (this checkout) on 5190, pointed at that API
 *   VITE_API_BASE_URL=http://localhost:3210 VITE_PAYMENT_PROVIDER=stripe npx vite --port 5190 --strictPort
 *     (another worktree's dev server shares node_modules/.vite: if pages load blank, start Vite with an untracked
 *     config that sets cacheDir: 'node_modules/.vite-payc03')
 *   # 5. The spec
 *   CYPRESS_BASE_URL=http://localhost:5190 CYPRESS_API_URL=http://localhost:3210 \
 *     CYPRESS_EMR_CORE_WORLD="$(cat $S/world.json)" CYPRESS_E2E_DB=vayd_api_test_cards_b \
 *     CYPRESS_STRIPE_LOG=$S/stripe.jsonl CYPRESS_EMAIL_CAPTURE_PATH=$S/mail.jsonl \
 *     npx cypress run --spec cypress/e2e/pay-c0-3-signup-card-on-file.cy.ts
 *   # 6. Clean
 *   cd <vayd-api> && DB_DATABASE=vayd_api_test_cards_b NODE_OPTIONS=--no-experimental-strip-types \
 *     npx ts-node -T test/scripts/pay-c0-3-e2e-seed.ts clean vayd_api_test_cards_b $S/world.json $S/prices.json
 *
 * The world JSON holds login tokens: never commit it. Re-seed for every run (one signup per dog).
 */

type PayC03World = ReturnType<typeof emrWorld> & {
  households: { member: EmrHousehold };
  visitInvoiceId: string;
  visitTotal: number;
  portal: {
    userId: number;
    clientName: string;
    packageId: number;
    priceMonthly: string;
    priceAnnual: string;
    auth: { Authorization: string; token: string };
  };
};

const FAKE_PM = 'pm_payc03_e2e_visa';
const TEST_INBOX = 'deirdre@vetatyourdoor.com';

const jsonLines = (text: string) =>
  text
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));

/** A stand-in for Stripe.js: one card field, and a payment method id for card 4242 (as in pay-01). */
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

describe('PAY-C0-3: a membership signup card is offered at the visit checkout', () => {
  it('portal client with no card signs up with 4242; checkout offers "Card on file · Visa •4242" with no re-consent note', () => {
    const w = emrWorld() as unknown as PayC03World;
    const { clientId, email, pets } = w.households.member;
    const [dog] = pets;
    const stripeLog = Cypress.env('STRIPE_LOG') as string;
    const mailLog = Cypress.env('EMAIL_CAPTURE_PATH') as string;
    expect(stripeLog, 'CYPRESS_STRIPE_LOG').to.be.a('string');
    expect(mailLog, 'CYPRESS_EMAIL_CAPTURE_PATH').to.be.a('string');
    expect(w.visitInvoiceId, 'world.visitInvoiceId (pay-c0-3-e2e-seed.ts)').to.be.a('string');

    // ── Before: no card on file, no Stripe customer, nothing for checkout to offer ──
    emrSql(
      `SELECT coalesce("stripeCustomerId", '') || '|' || coalesce("savedPaymentMethodId", '') FROM clients WHERE id = ${clientId}`,
    ).then((v) => expect(v, 'customer|card before').to.eq('|'));
    emrSql(`SELECT count(*) FROM wellness_plans WHERE "patientId" = ${dog.patientId} AND NOT "isDeleted"`).then((n) =>
      expect(n, 'memberships before').to.eq('0'),
    );
    emrApi('practice_manager', 'GET', `/visit-payments/${w.visitInvoiceId}/card-on-file?practiceId=${w.practiceId}`).then((r) =>
      expect(r.card ?? null, 'card on file before').to.eq(null),
    );
    cy.readFile(stripeLog).then((t: string) => cy.wrap(jsonLines(t).length).as('stripeBefore'));
    cy.readFile(mailLog).then((t: string) => cy.wrap(jsonLines(t).length).as('mailBefore'));

    // ── The portal signup (as pay-01-membership-signup.cy.ts) ──
    cy.intercept('https://js.stripe.com/**', { statusCode: 200, body: '' });
    cy.intercept('GET', '**/practice/public-config', (req) => {
      req.continue((res) => {
        res.body = { ...res.body, stripePublishableKey: res.body?.stripePublishableKey || 'pk_test_payc03_fake' };
      });
    });
    cy.intercept('POST', '**/stripe/payment-processing/payments').as('checkout');

    cy.visit('/login');
    cy.window().then((win) => {
      win.localStorage.clear();
      win.localStorage.setItem('accessToken', w.portal.auth.token);
      win.localStorage.setItem('vayd_clientId', String(clientId));
    });
    cy.visit('/client-portal', { onBeforeLoad: installFakeStripeJs });

    cy.contains('button', `Explore plans for ${dog.name}`, { timeout: 30000 }).scrollIntoView().click();
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
    cy.get('input[placeholder="Type your full name"]').type(w.portal.clientName);
    cy.contains('button', 'Continue to Payment').should('not.be.disabled').click();

    // MembershipPayment: no card on file, so no "Use Visa ending …" choice (PAY-C7); the client types the card.
    cy.get('input[placeholder="Full name on card"]', { timeout: 30000 });
    cy.get('input[name="membership-card-choice"]').should('not.exist');
    cy.contains(/Use \w+ ending/).should('not.exist');
    cy.get('body').then(($b) => {
      if ($b.find('input[placeholder="you@example.com"]').length) {
        cy.get('input[placeholder="you@example.com"]').clear().type(email);
      }
    });
    cy.get('input[placeholder="Full name on card"]').type(w.portal.clientName);
    cy.get('input[placeholder="Address line 1"]').type('1 Test St');
    cy.get('input[placeholder="City"]').type('Portland');
    cy.get('input[placeholder="State"]').type('ME');
    cy.get('input[placeholder="Postal Code"]').type('04101');
    cy.get('#card-container [data-fake-stripe-card]', { timeout: 30000 }).type('4242424242424242');
    cy.contains('button', /Pay & Enroll/i).should('not.be.disabled').click();

    cy.wait('@checkout', { timeout: 60000 }).then(({ request, response }) => {
      expect(response?.statusCode, 'checkout status').to.eq(201);
      expect(response?.body?.success, 'checkout success').to.eq(true);
      expect(Number(request.body.membershipTransaction?.clientId)).to.eq(clientId);
      expect(Number(request.body.membershipTransaction?.patientId)).to.eq(dog.patientId);
      expect(request.body.sourceId).to.eq(FAKE_PM);
    });
    cy.contains('h1', 'Payment Successful', { timeout: 30000 });
    cy.contains(`${dog.name} is now enrolled`);

    // ── The signup card is now the household's card on file, under the membership agreement ──
    cy.get<number>('@stripeBefore').then((before) => {
      cy.readFile(stripeLog).then((t: string) => {
        const fresh = jsonLines(t).slice(before) as Array<{ method: string; url: string; body: string }>;
        const path = (u: string) => u.split('?')[0];
        const customers = fresh.filter((r) => r.method === 'POST' && path(r.url) === '/v1/customers');
        expect(customers, 'new Stripe customers').to.have.length(1);
        const subs = fresh.filter((r) => r.method === 'POST' && path(r.url) === '/v1/subscriptions');
        expect(subs, 'Stripe subscriptions created').to.have.length(1);
        const customer = new URLSearchParams(subs[0].body).get('customer') ?? '';
        expect(customer).to.match(/^cus_fake_/);
        expect(fresh.filter((r) => r.method === 'POST' && /^\/v1\/payment_intents/.test(path(r.url))), 'one-off charges').to.have.length(0);
        cy.wrap(customer).as('customer');
      });
    });
    cy.get<string>('@customer').then((customer) => {
      emrSql(
        `SELECT "stripeCustomerId" || '|' || "savedPaymentMethodId" || '|' || coalesce("cardOnFileConsentSource", '')
           FROM clients WHERE id = ${clientId}`,
      ).then((v) => expect(v, 'customer|card|consent source').to.eq(`${customer}|${FAKE_PM}|membership`));
    });
    emrSql(`SELECT coalesce("cardOnFileConsentAgreementVersion", '') FROM clients WHERE id = ${clientId}`).then((version) => {
      expect(version, 'card-on-file agreement version').to.match(/^\d{4}-\d{2}-\d{2}$/);
      cy.wrap(version).as('agreementVersion');
    });

    // The visit invoice's card endpoint (what checkout reads) finds it: Visa 4242, not expired, current agreement.
    cy.get<string>('@agreementVersion').then((version) => {
      emrApi('practice_manager', 'GET', `/visit-payments/${w.visitInvoiceId}/card-on-file?practiceId=${w.practiceId}`).then((r) => {
        expect(r.card, 'card on file after signup').to.be.an('object');
        expect(r.card.paymentMethodId).to.eq(FAKE_PM);
        expect(r.card.brand).to.eq('visa');
        expect(r.card.last4).to.eq('4242');
        expect(r.card.expired, 'expired').to.eq(false);
        if ('consentAgreementVersion' in r.card) {
          expect(r.card.consentAgreementVersion, 'agreement on the card checkout charges').to.eq(version);
        }
      });
    });

    // ── Staff open checkout for the dog's visit ──
    cy.intercept('GET', '**/visit-payments/*/card-on-file*').as('cardOnFile');
    signInEmr('practice_manager', soapPath(dog, clientId, '/checkout'));
    cy.contains('h1', 'Checkout', { timeout: 40000 });
    cy.wait('@cardOnFile', { timeout: 40000 }).then(({ response }) => {
      expect(response?.statusCode).to.eq(200);
      expect(response?.body?.card?.last4).to.eq('4242');
    });

    cy.get('[data-testid="card-on-file-button"]', { timeout: 30000 })
      .should('contain.text', 'Card on file · Visa •4242')
      .and('not.be.disabled');
    // No re-consent: no "keep this card on file" ask, no expired-card note, nothing about agreeing again.
    cy.get('.soap-checkout-consent').should('not.exist');
    cy.get('[data-testid="card-on-file-expired"]').should('not.exist');
    cy.contains(/re-?consent/i).should('not.exist');

    // The confirm names the card and the amount due (the charge itself is not made here).
    cy.get('[data-testid="card-on-file-button"]').click();
    emrApi('practice_manager', 'GET', `/visit-invoices/${w.visitInvoiceId}?practiceId=${w.practiceId}`).then((inv) => {
      const due = (Number(inv.total) || 0) - (Number(inv.amountPaid) || 0);
      expect(due, 'amount due').to.be.greaterThan(0);
      cy.get('[data-testid="card-on-file-confirm"]').within(() => {
        cy.contains('button', `Charge $${due.toFixed(2)} to Visa •4242`).should('not.be.disabled');
        cy.contains('button', 'Cancel').click();
      });
    });
    cy.get('[data-testid="card-on-file-confirm"]').should('not.exist');
    cy.contains(/re-?consent/i).should('not.exist');

    // Nothing was charged: the visit invoice is still open with no payments.
    emrApi('practice_manager', 'GET', `/visit-invoices/${w.visitInvoiceId}?practiceId=${w.practiceId}`).then((inv) => {
      expect(inv.status).to.not.eq('paid');
      expect(Number(inv.amountPaid)).to.eq(0);
    });

    // Emails: one welcome email, captured, and only to the test inbox.
    cy.get<number>('@mailBefore').then((before) => {
      cy.readFile(mailLog).then((t: string) => {
        const fresh = jsonLines(t).slice(before) as Array<{ to?: string | string[]; subject?: string }>;
        const welcome = fresh.filter((m) => String(m.subject ?? '').includes(`Welcome to VAYD Membership - ${dog.name}`));
        expect(welcome, 'welcome emails').to.have.length(1);
        for (const m of fresh) {
          expect([].concat((m.to ?? []) as never), `recipients of "${m.subject}"`).to.deep.eq([TEST_INBOX]);
        }
      });
    });
  });
});

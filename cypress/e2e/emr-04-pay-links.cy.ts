/// <reference types="cypress" />
import '../support/e2e';
import { cleanEmrWorld, emrApi, seedEmrWorld, type EmrWorld } from '../support/emrWorld';
import { stubGmailCapture } from '../support/emrCoreVisitWorld';

/**
 * EMR-04-6: pay links on screen. Staff opens the client's Billing, makes the email link and then the
 * text link for the same balance: both carry the same URL (one Stripe Checkout session). A payment
 * marks the bill Paid; a second payment for the same balance shows as account credit, with a Billing
 * task opened the same day (owner decision D3: never refunded automatically).
 *
 *   EMR_DB=vayd_api_test CYPRESS_EMR_DB=vayd_api_test npx cypress run --spec cypress/e2e/emr-04-pay-links.cy.ts
 *
 * The dev API must use the same test database. Gmail is stubbed in the browser (the test database has no mailbox); the email send is intercepted and captured, never real.
 * Payments are simulated with signed payment_intent.succeeded webhooks (task emrStripeWebhook), which is
 * what Stripe sends when a Checkout link is paid; local dev receives no real webhooks.
 */

const db = () => String(Cypress.env('EMR_DB') || '');
const apiBase = () =>
  (Cypress.env('API_URL') || Cypress.config('baseUrl')?.replace(':5173', ':3000') || 'http://localhost:3000') as string;

function emrSql(statement: string): Cypress.Chainable<string> {
  if (!/test/i.test(db()) || /vayd_api_local|prod/i.test(db())) {
    throw new Error(`Set CYPRESS_EMR_DB to the EMR test database (got "${db()}")`);
  }
  return cy
    .exec('psql -h localhost -U vayd -d ' + db() + ' -tA -c "$EMR_SQL"', {
      env: { PGPASSWORD: 'vayd', EMR_SQL: statement },
    })
    .then((r) => r.stdout.trim().split('\n')[0] ?? '');
}

function signIn(world: EmrWorld, path: string) {
  cy.visit('/login');
  cy.window().then((win) => {
    win.localStorage.clear();
    win.localStorage.setItem('accessToken', world.staff.token);
  });
  cy.visit(path);
}

const billingPath = (world: EmrWorld) =>
  `/schedule/clients?clientId=${world.client.id}&tab=financial&invoice=${world.visit.invoiceId}`;

function paid(world: EmrWorld, paymentIntentId: string, amountCents: number) {
  return cy
    .task<{ status: number; body: string }>('emrStripeWebhook', {
      apiUrl: apiBase(),
      paymentIntentId,
      amountCents,
      metadata: {
        source: 'scout_pay_link',
        clientId: String(world.client.id),
        practiceId: String(world.practiceId),
        visitInvoiceId: world.visit.invoiceId,
        visitInvoiceIds: world.visit.invoiceId,
      },
    })
    .then((res) => expect(res.status, res.body).to.eq(200));
}

function invoice(world: EmrWorld) {
  return emrApi(world, 'GET', `/visit-invoices/${world.visit.invoiceId}?practiceId=${world.practiceId}`).then((res) => {
    expect(res.status).to.eq(200);
    return res.body as { status: string; total: string | number; amountPaid: string | number; tenders?: Array<{ amount: string | number; stripePaymentIntentId?: string | null }> };
  });
}

describe('EMR-04-6: one pay link per balance; a second payment becomes credit with a task', () => {
  let world: EmrWorld;
  const run = Date.now().toString(36);
  const piFirst = `pi_emr04_6_a_${run}`;
  const piSecond = `pi_emr04_6_b_${run}`;

  before(() => seedEmrWorld().then((w) => (world = w)));
  after(() => {
    if (world) {
      emrSql(
        `DELETE FROM task_link WHERE "taskId" IN (SELECT id FROM tasks WHERE "idempotencyKey" IN ('overpayment:${piFirst}','overpayment:${piSecond}'));` +
          ` DELETE FROM task_event WHERE "taskId" IN (SELECT id FROM tasks WHERE "idempotencyKey" IN ('overpayment:${piFirst}','overpayment:${piSecond}'));` +
          ` DELETE FROM tasks WHERE "idempotencyKey" IN ('overpayment:${piFirst}','overpayment:${piSecond}');` +
          ` DELETE FROM pay_link_redirects WHERE "clientId" = ${world.client.id}`,
      );
    }
    cleanEmrWorld();
  });

  it('email and text carry the same URL; the first payment pays; the second shows as credit with a Billing task', () => {
    const gmail = stubGmailCapture();
    cy.intercept('POST', '**/visit-payments/client/*/pay-link').as('payLink');
    signIn(world, billingPath(world));

    // Email pay link: the compose dialog body carries the link.
    cy.contains('button', 'Email pay link', { timeout: 40000 }).click();
    cy.wait('@payLink').then(({ response }) => {
      const emailUrl = String(response?.body?.url ?? '');
      expect(emailUrl, 'email link').to.match(/\/public\/pay\/|checkout\.stripe\.com/);
      expect(Number(response?.body?.amount)).to.eq(world.visit.invoiceTotal);
      cy.wrap(emailUrl).as('emailUrl');
    });
    cy.get<string>('@emailUrl').then((emailUrl) => {
      cy.contains('button', 'Send email', { timeout: 30000 }).should('not.be.disabled').click();
      cy.wrap(null).should(() => {
        expect(gmail.sent(), 'captured emails').to.have.length(1);
        expect(String(gmail.sent()[0].bodyText ?? '') + String(gmail.sent()[0].bodyHtml ?? '')).to.contain(emailUrl);
      });
    });
    cy.get('[role="dialog"]').should('not.exist');

    // Text pay link for the same balance: the same URL, in the SMS text.
    cy.contains('button', 'Text pay link').click();
    cy.wait('@payLink').then(({ response }) => {
      cy.get<string>('@emailUrl').then((emailUrl) => {
        expect(String(response?.body?.url ?? ''), 'text link').to.eq(emailUrl);
        cy.get('[role="dialog"] textarea').invoke('val').should('contain', emailUrl);
      });
    });
    cy.get('[role="dialog"]').contains('button', 'Cancel').click();

    // The client pays the link once: the bill is paid.
    paid(world, piFirst, world.visit.invoiceTotal * 100);
    invoice(world).then((inv) => {
      expect(inv.status).to.eq('paid');
      expect(Number(inv.amountPaid)).to.eq(world.visit.invoiceTotal);
    });
    cy.reload();
    cy.contains(/paid/i, { timeout: 30000 }).should('exist');

    // The client pays it again: kept as credit, nothing refunded, Billing gets a task due today.
    paid(world, piSecond, world.visit.invoiceTotal * 100);
    invoice(world).then((inv) => {
      expect(inv.status).to.eq('paid');
      expect(Number(inv.amountPaid)).to.eq(world.visit.invoiceTotal * 2);
      expect((inv.tenders ?? []).filter((t) => t.stripePaymentIntentId)).to.have.length(2);
    });
    cy.reload();
    cy.contains(/credit/i, { timeout: 30000 }).should('exist');
    cy.contains(`$${world.visit.invoiceTotal.toFixed(2)}`).should('exist');
    emrSql(
      `SELECT status || '|' || (("dueAt" AT TIME ZONE 'UTC')::date = (now() AT TIME ZONE 'UTC')::date OR "dueAt"::date = now()::date) FROM tasks WHERE "idempotencyKey" = 'overpayment:${piSecond}'`,
    ).should('eq', 'open|true');
    emrSql(`SELECT count(*) FROM tasks WHERE "idempotencyKey" = 'overpayment:${piFirst}'`).should('eq', '0');
  });
});

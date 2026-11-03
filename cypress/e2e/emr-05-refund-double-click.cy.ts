/// <reference types="cypress" />
import '../support/e2e';
import { cleanEmrWorld, emrApi, seedEmrWorld, type EmrWorld } from '../support/emrWorld';

/**
 * EMR-05-6: a double-clicked refund refunds once. Staff refunds 100 of a 150 card payment on a paid
 * bill and double-clicks "Process refund": one refund line on screen, 100 refunded, and the ledger
 * took the Stripe refund off once.
 *
 *   EMR_DB=vayd_api_test CYPRESS_EMR_DB=vayd_api_test EMR_STRIPE=test npx cypress run --spec cypress/e2e/emr-05-refund-double-click.cy.ts
 *
 * The dev API must use the same test database and a Stripe TEST key: the card payment is a real
 * test-mode charge of the seeded card (EMR_STRIPE=test makes the seed create it at Stripe), so the
 * refund is a real test-mode refund.
 */

const db = () => String(Cypress.env('EMR_DB') || '');

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

type Tender = { id: string; method: string; amount: string | number; refundedAmount?: string | number; stripePaymentIntentId?: string | null; voidedAt?: string | null };

function invoice(world: EmrWorld) {
  return emrApi(world, 'GET', `/visit-invoices/${world.visit.invoiceId}?practiceId=${world.practiceId}`).then((res) => {
    expect(res.status).to.eq(200);
    return res.body as { status: string; total: string | number; amountPaid: string | number; tenders?: Tender[] };
  });
}

describe('EMR-05-6: a double-clicked refund is applied once', () => {
  let world: EmrWorld;

  before(() =>
    seedEmrWorld().then((w) => {
      world = w;
      // The household card, agreed to under the current card-on-file wording (decision 35).
      emrSql(
        `UPDATE clients SET "stripeCustomerId" = '${w.savedCard.customerId}', "savedPaymentMethodId" = '${w.savedCard.paymentMethodId}',` +
          ` "cardOnFileConsentAt" = now(), "cardOnFileConsentSource" = 'manual', "cardOnFileConsentAgreementVersion" = '2026-10-07'` +
          ` WHERE id = ${w.client.id}`,
      );
      // Refunds are open to visit staff; give the seeded login a Scout role so the screen offers it.
      emrSql(
        `INSERT INTO employee_role_assignments ("employeeId", "roleId", "branchId")` +
          ` SELECT ${w.staff.employeeId}, id, NULL FROM employee_role WHERE slug = 'veterinarian' AND "pimsType" = 'SCOUT' AND "isDeleted" = false LIMIT 1`,
      );
    }),
  );
  after(() => {
    if (world) emrSql(`DELETE FROM employee_role_assignments WHERE "employeeId" = ${world.staff.employeeId}`);
    cleanEmrWorld();
  });

  it('one refund line, 100 refunded, the bill owes 100 again', () => {
    // A card payment of 150 on the bill: it is now paid.
    emrApi(world, 'POST', `/visit-payments/${world.visit.invoiceId}/charge-saved-card`, { practiceId: world.practiceId }).then((res) => {
      expect(res.status, JSON.stringify(res.body)).to.be.lessThan(300);
      expect(res.body.status).to.eq('paid');
    });

    cy.intercept('POST', '**/tenders/*/refund').as('refund');
    signIn(world, `/schedule/clients?clientId=${world.client.id}&tab=financial&invoice=${world.visit.invoiceId}`);
    // Scout receipt: the card line reads like "Visa •••• 4242"; only a refundable card payment has a Refund button.
    cy.contains('.client-fin__paid-line', 'Refund', { timeout: 40000 }).contains('button', 'Refund').click();
    cy.get('.client-fin__refund-panel').within(() => {
      cy.contains('label', 'Amount (partial or full)').find('input').clear().type('100');
      cy.contains('label', 'Reason (optional)').find('input').type('Client declined the vaccine');
      cy.contains('button', 'Process refund').dblclick();
    });
    cy.wait('@refund');
    cy.get('.client-fin__refund-panel', { timeout: 20000 }).should('not.exist');

    // On screen: one refund, of 100.
    cy.contains(/Refunded \$100\.00/, { timeout: 20000 }).should('exist');
    // One payment row on the receipt carries the refund (the ledger and status areas repeat the amount).
    cy.get('.client-fin__paid-line').filter(':contains("Refunded $100.00")').should('have.length', 1);
    cy.contains(/Refunded \$200\.00/).should('not.exist');

    // Recorded: the card payment has 100 refunded once, and the bill owes 100.
    invoice(world).then((inv) => {
      const cards = (inv.tenders ?? []).filter((t) => t.stripePaymentIntentId);
      expect(cards).to.have.length(1);
      expect(Number(cards[0].refundedAmount)).to.eq(100);
      expect(cards[0].voidedAt ?? null).to.eq(null);
      expect(Number(inv.amountPaid)).to.eq(50);
      expect(inv.status).not.to.eq('paid');
    });
    emrSql(
      `SELECT coalesce(array_length("stripeRefundIds", 1), 0) FROM visit_invoice_tenders WHERE "invoiceId" = '${world.visit.invoiceId}' AND method = 'card'`,
    ).should('eq', '1');
  });
});

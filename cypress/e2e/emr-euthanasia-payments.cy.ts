/// <reference types="cypress" />
import '../support/e2e';
import { cleanEmrWorld, emrApi, seedEmrWorld, type EmrWorld } from '../support/emrWorld';

/**
 * EMR-01-6, EMR-02-5, EMR-02-6: euthanasia money on screen.
 *
 *   EMR_DB=vayd_api_test CYPRESS_EMR_DB=vayd_api_test npx cypress run --spec cypress/e2e/emr-euthanasia-payments.cy.ts
 *
 * The dev API must use the same test database. The world's saved card is the Stripe test reference
 * pm_card_visa on cus_emr_world (see cypress/support/emrWorld.ts): against Stripe test mode that customer
 * must exist first. Amounts are checked on what Scout recorded (card tenders), which is what was
 * captured or charged.
 */

const db = () => String(Cypress.env('EMR_DB') || '');

/** One SQL statement on the EMR test database (refuses anything not named "test"). */
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

const checkoutPath = (appointmentId: number, patientId: number, clientId: number) =>
  `/schedule/soap/${appointmentId}/${patientId}/checkout?clientId=${clientId}`;

type Tender = { method: string; amount: string | number; stripePaymentIntentId?: string | null; voidedAt?: string | null };

function invoiceById(world: EmrWorld, id: string) {
  return emrApi(world, 'GET', `/visit-invoices/${id}?practiceId=${world.practiceId}`).then((res) => {
    expect(res.status).to.eq(200);
    return res.body as { id: string; status: string; total: string | number; amountPaid: string | number; tenders?: Tender[]; lines?: Array<{ description: string; isDeleted?: boolean }> };
  });
}

const cardTenders = (inv: { tenders?: Tender[] }) =>
  (inv.tenders ?? []).filter((t) => !t.voidedAt && t.stripePaymentIntentId);

describe('EMR-01-6: Convert Authorization captures the new total (legacy prepay invoice)', () => {
  let world: EmrWorld;
  before(() => seedEmrWorld().then((w) => (world = w)));
  after(() => cleanEmrWorld());

  it('staff removes a line, converts, and the bill shows Paid at the new total', () => {
    const { appointmentId, patientId, invoiceId } = world.visit;
    // An invoice that already uses the old prepay path: flagged prepay with a card saved at booking.
    emrSql(`UPDATE visit_invoices SET "isEuthanasiaPrepay" = true, "stripeSetupIntentId" = 'seti_emr01_6' WHERE id = '${invoiceId}'`);
    emrApi(world, 'POST', '/soap-encounters', { practiceId: world.practiceId, appointmentId, patientId, clientId: world.client.id });
    // The hold on 150.00, placed the old way (checkout "Authorize card").
    emrApi(world, 'POST', `/visit-payments/${invoiceId}/authorize`, { practiceId: world.practiceId }).then((res) => {
      expect(res.status, JSON.stringify(res.body)).to.be.lessThan(300);
      expect(res.body.lastChargeStatus).to.eq('requires_capture');
    });

    signIn(world, checkoutPath(appointmentId, patientId, world.client.id));
    cy.contains('Vaccine - FVRCP', { timeout: 40000 })
      .parents('[class*="soap-invoice-line"]')
      .first()
      .find('button[title="Remove from checkout"]')
      .click();
    cy.on('window:confirm', () => true);
    invoiceById(world, invoiceId).its('total').then((t) => expect(Number(t)).to.eq(90));

    cy.contains('button', 'Convert Authorization to Payment').click();
    cy.contains(/paid/i, { timeout: 30000 }).should('be.visible');

    invoiceById(world, invoiceId).then((inv) => {
      expect(inv.status).to.eq('paid');
      expect(Number(inv.total)).to.eq(90);
      expect(Number(inv.amountPaid)).to.eq(90);
      // What was captured from the 150 hold is the new total, not the hold.
      const cards = cardTenders(inv);
      expect(cards).to.have.length(1);
      expect(Number(cards[0].amount)).to.eq(90);
    });
  });
});

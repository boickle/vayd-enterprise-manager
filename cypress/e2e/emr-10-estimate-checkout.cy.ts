/// <reference types="cypress" />
import '../support/e2e';
import { cleanEmrWorld, emrApi, seedEmrWorld, type EmrWorld } from '../support/emrWorld';

/**
 * EMR-10-9 (owner decision D4, Nov 2, 2026): euthanasia visit with a hold, full flow.
 *
 * The doctor orders cremation on the SOAP while the estimate already has it: the duplicate warning
 * lists the estimate line and the doctor cancels (nothing is added).
 *
 * Changed by the owner decisions of Nov 3, 2026: no per-item Accept / Decline at checkout. The family
 * changes their mind about the clay paw before checkout and staff take it off the estimate by hand.
 * Checkout lists the items read-only and the bubble says what the owner approved ($515) and that the
 * bill is $40 less, so the rest of the hold is released. "Run Payment from Authorization" takes one
 * capture equal to the bill.
 *
 *   EMR_DB=vayd_api_test CYPRESS_EMR_DB=vayd_api_test npx cypress run --spec cypress/e2e/emr-10-estimate-checkout.cy.ts
 *
 * The dev API must use the same test database. Catalog items are invented procedures (pimsType EMRTEST).
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

type Tender = { amount: string | number; stripePaymentIntentId?: string | null; voidedAt?: string | null };
type Invoice = {
  id: string;
  status: string;
  total: string | number;
  amountPaid: string | number;
  tenders?: Tender[];
  lines?: Array<{ description: string; isDeleted?: boolean }>;
};

function invoiceForAppointment(world: EmrWorld, appointmentId: number): Cypress.Chainable<Invoice> {
  return emrApi(world, 'GET', `/visit-invoices/by-appointment/${appointmentId}?practiceId=${world.practiceId}`).then((res) => {
    expect(res.status).to.eq(200);
    return emrApi(world, 'GET', `/visit-invoices/${res.body.id}?practiceId=${world.practiceId}`).then((inv) => {
      expect(inv.status).to.eq(200);
      return inv.body as Invoice;
    });
  });
}

describe('EMR-10-9: estimate items at checkout, duplicate warning on the SOAP', () => {
  let world: EmrWorld;
  let cremationName: string;
  let cremationId: number;
  let clayId: number;

  const procedure = (name: string, price: number) =>
    emrSql(
      `INSERT INTO procedures (name, code, price, "taxLevelValue", "practiceId", "pimsId", "pimsType", "isActive", "isDeleted")
       VALUES ('${name}', '${name}', ${price}, 0, ${world.practiceId}, '${world.tag}-${name}', 'EMRTEST', true, false) RETURNING id`,
    ).then(Number);

  before(() =>
    seedEmrWorld().then((w) => {
      world = w;
      cremationName = `Private cremation ${w.tag}`;
      procedure(cremationName, 125).then((id) => {
        cremationId = id;
        // The seeded quote's cremation line is this catalog item.
        emrSql(
          `UPDATE visit_estimate_lines SET "catalogItemId" = ${id}, "catalogItemType" = 'procedure'
            WHERE "estimateId" = '${w.euthanasia.estimateId}' AND description = 'Private cremation - small'`,
        );
      });
      procedure(`Clay paw print ${w.tag}`, 40).then((id) => (clayId = id));
    }),
  );
  after(() => {
    // Settling posts chart treatment lines that point at these procedures: clean the world first,
    // then any treatment lines still on the test procedures, then the procedures.
    cleanEmrWorld();
    if (world) {
      const mine = `SELECT id FROM procedures WHERE "pimsType" = 'EMRTEST' AND "pimsId" LIKE '${world.tag}-%'`;
      emrSql(`UPDATE invoice_items SET "treatmentItemId" = NULL WHERE "treatmentItemId" IN (SELECT id FROM treatment_items WHERE "procedureId" IN (${mine}))`);
      emrSql(`DELETE FROM treatment_items WHERE "procedureId" IN (${mine})`);
      emrSql(`DELETE FROM procedures WHERE id IN (${mine})`);
    }
  });

  it('cancelled duplicate adds nothing; the clay paw taken off is not billed; one capture of the bill', () => {
    const { appointmentId, patientId, estimateId } = world.euthanasia;
    const clientId = world.client.id;

    // The family also picked a clay paw (40): quote is 350 + 125 + 40 = 515, held on their card.
    emrApi(world, 'POST', `/visit-estimates/${estimateId}/lines`, {
      practiceId: world.practiceId,
      patientId,
      description: 'Clay paw print',
      qty: 1,
      unitPrice: 40,
      catalogItemId: clayId,
      catalogItemType: 'procedure',
    }).then((res) => {
      cy.log(`clay line POST ${res.status}: ${JSON.stringify(res.body)}`);
      expect(res.status, JSON.stringify(res.body)).to.be.lessThan(300);
    });
    emrApi(world, 'POST', `/visit-estimates/${estimateId}/accept`, { practiceId: world.practiceId });
    emrApi(world, 'POST', `/visit-estimates/${estimateId}/authorize`, { practiceId: world.practiceId }).then((res) => {
      expect(res.status, JSON.stringify(res.body)).to.be.lessThan(300);
      expect(Number(res.body.authorizedAmount)).to.eq(515);
    });

    // The doctor opens the SOAP and orders cremation: the warning lists the estimate line; Cancel.
    emrApi(world, 'POST', '/soap-encounters', { practiceId: world.practiceId, appointmentId, patientId, clientId }).then((enc) => {
      expect(enc.status).to.be.lessThan(300);
      signIn(world, `/schedule/soap/${appointmentId}/${patientId}?clientId=${clientId}`);
      cy.intercept('POST', '**/soap-encounters/*/orders').as('addOrder');
      cy.intercept('GET', '**/room-loader/items/search*').as('planSearch');
      cy.get('input[placeholder="Type here to add a charge, or a note…"]', { timeout: 40000 })
        .first()
        .type(cremationName);
      cy.wait('@planSearch');
      // Pick the catalog result by its full unique name. The "Add as note: <typed text>" row is always
      // in the list and also contains the name, so leave it out (clicking it creates a $0 note order).
      cy.contains('.soap-plan-result:not(.soap-plan-result-note) .soap-plan-result-name', cremationName, { timeout: 20000 })
        .closest('.soap-plan-result')
        .click();
      cy.wait('@addOrder').then((i) => {
        cy.log(`addOrder ${i.response?.statusCode}: ${JSON.stringify(i.request.body)}`);
        expect(i.request.body.catalogItemId, 'ordered the cremation procedure').to.eq(cremationId);
        expect(i.request.body.catalogItemType).to.eq('procedure');
      });
      cy.get('[role="dialog"]', { timeout: 20000 }).within(() => {
        cy.contains('Already entered for this pet');
        cy.contains('Estimate: Private cremation - small');
        cy.contains('button', 'Add anyway').should('exist');
        cy.contains('button', 'Cancel').click();
      });
      cy.get('[role="dialog"]').should('not.exist');
      emrApi(world, 'GET', `/soap-encounters/${enc.body.id}/orders?practiceId=${world.practiceId}`).then((orders) => {
        expect(orders.status).to.eq(200);
        expect((orders.body as Array<{ catalogItemId: number | null }>).filter((o) => Number(o.catalogItemId) === cremationId)).to.have.length(0);
      });
    });

    // Before checkout the family changes their mind about the clay paw: staff take it off the estimate.
    emrApi(world, 'GET', `/visit-estimates/${estimateId}?practiceId=${world.practiceId}`).then((res) => {
      const clay = (res.body.lines as Array<{ id: string; description: string }>).find((l) => l.description === 'Clay paw print');
      expect(clay, 'clay line on the quote').to.exist;
      emrApi(world, 'DELETE', `/visit-estimates/${estimateId}/lines/${clay!.id}?practiceId=${world.practiceId}`).then((del) =>
        expect(del.status).to.be.lessThan(300),
      );
    });

    // Checkout: the items are listed read-only (no Accept / Decline); the bubble explains the money.
    signIn(world, `/schedule/soap/${appointmentId}/${patientId}/checkout?clientId=${clientId}`);
    cy.contains('Estimate given to the family', { timeout: 40000 }).should('be.visible');
    cy.get('[data-testid="estimate-settle-line"]').should('have.length', 2);
    cy.get('[data-testid="estimate-settle-line"] button').should('not.exist');
    cy.get('[data-testid="estimate-authorization-bubble"]', { timeout: 20000 })
      .should('contain.text', 'This owner approved $515.00')
      .and('contain.text', 'it will be charged when you click "Run Payment from Authorization".')
      .and('contain.text', '$40.00 less than authorized — the rest of the hold is released.');
    cy.contains('button', 'Run Payment from Authorization').should('not.be.disabled').click();
    cy.contains('Estimate given to the family', { timeout: 30000 }).should('not.exist');

    invoiceForAppointment(world, appointmentId).then((inv) => {
      expect(inv.status).to.eq('paid');
      expect(Number(inv.total)).to.eq(475);
      expect(Number(inv.amountPaid)).to.eq(475);
      const live = (inv.lines ?? []).filter((l) => !l.isDeleted);
      expect(live.map((l) => l.description).sort()).to.deep.eq(['Euthanasia - at home', 'Private cremation - small']);
      const cards = (inv.tenders ?? []).filter((t) => !t.voidedAt && t.stripePaymentIntentId);
      expect(cards, 'one capture').to.have.length(1);
      expect(Number(cards[0].amount)).to.eq(475);
    });
    // The decision column is kept but unused.
    emrSql(`SELECT count(*) FROM visit_estimate_lines WHERE "estimateId" = '${estimateId}' AND decision IS NOT NULL`).should('eq', '0');
  });
});

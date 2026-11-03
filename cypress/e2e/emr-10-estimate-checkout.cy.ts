/// <reference types="cypress" />
import '../support/e2e';
import { cleanEmrWorld, emrApi, seedEmrWorld, type EmrWorld } from '../support/emrWorld';

/**
 * EMR-10-9 (owner decision D4, Nov 2, 2026): euthanasia visit with a hold, full flow.
 *
 * The doctor orders cremation on the SOAP while the estimate already has it: the duplicate warning
 * lists the estimate line and the doctor cancels (nothing is added). At checkout the estimate's items
 * are listed; staff decline the clay paw with the family, accept the rest, and settle. The invoice
 * has the accepted lines only, and one capture equal to them.
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
    if (world) emrSql(`DELETE FROM procedures WHERE "pimsType" = 'EMRTEST' AND "pimsId" LIKE '${world.tag}-%'`);
    cleanEmrWorld();
  });

  it('cancelled duplicate adds nothing; declined clay paw is not billed; one capture of the accepted total', () => {
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
      cy.get('input[placeholder="Type here to add a charge, or a note…"]', { timeout: 40000 })
        .first()
        .type(cremationName);
      // Pick the exact item by its full unique name (the tag makes it unique among search results).
      cy.contains('.soap-plan-result .soap-plan-result-name', cremationName, { timeout: 20000 })
        .closest('.soap-plan-result')
        .click();
      cy.wait('@addOrder').then((i) => {
        cy.log(`addOrder ${i.response?.statusCode}: ${JSON.stringify(i.request.body)}`);
        expect(i.request.body.catalogItemId, 'ordered the cremation procedure').to.eq(cremationId);
        expect(i.request.body.catalogItemType).to.eq('procedure');
      });
      cy.get('[role="dialog"]', { timeout: 20000 }).within(() => {
        cy.contains('Already on this visit');
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

    // Checkout: the items are listed; the family declines the clay paw and accepts the rest.
    signIn(world, `/schedule/soap/${appointmentId}/${patientId}/checkout?clientId=${clientId}`);
    cy.contains('Estimate given to the family', { timeout: 40000 }).should('be.visible');
    cy.get('[data-testid="estimate-settle-line"]').should('have.length', 3);
    cy.contains('button', 'Convert to invoice & take payment').should('be.disabled');
    cy.contains('[data-testid="estimate-settle-line"]', 'Clay paw print').find('button').contains('Decline').click();
    cy.contains('[data-testid="estimate-settle-line"]', 'Clay paw print').find('button[aria-pressed="true"]').should('contain.text', 'Decline');
    cy.contains('button', /Accept the 2 remaining items/).click();
    cy.get('[data-testid="estimate-settle-accepted-total"]', { timeout: 20000 }).should('have.text', '$475.00');
    cy.contains('button', 'Convert to invoice & take payment').should('not.be.disabled').click();
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
    emrSql(`SELECT decision FROM visit_estimate_lines WHERE "estimateId" = '${estimateId}' AND description = 'Clay paw print'`).should(
      'eq',
      'declined',
    );
  });
});

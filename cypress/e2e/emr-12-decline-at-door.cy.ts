/// <reference types="cypress" />
import '../support/e2e';
import { cleanEmrWorld, emrApi, seedEmrWorld, type EmrWorld } from '../support/emrWorld';

/**
 * EMR-12-8: the family declines euthanasia at the door.
 *
 * Seeded euthanasia visit (Pippin, 475.00 quote) with the card held and the consent signed. The doctor
 * opens checkout, the family declines, staff press "Family declined" and confirm, then cancel the visit.
 * No charge is shown or taken, the hold is released, the consent is marked withdrawn, and the visit
 * closes with no bill.
 *
 *   EMR_DB=vayd_api_test CYPRESS_EMR_DB=vayd_api_test npx cypress run --spec cypress/e2e/emr-12-decline-at-door.cy.ts
 *
 * The dev API must use the same test database. Written for Stripe test mode (EMR_STRIPE=test).
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

describe('EMR-12-8: family declines at the door', () => {
  let world: EmrWorld;

  before(() => seedEmrWorld().then((w) => (world = w)));
  after(() => cleanEmrWorld());

  it('no charge, hold released, consent withdrawn, visit closes without a bill', () => {
    const { appointmentId, patientId, estimateId, consentInviteId } = world.euthanasia;
    const clientId = world.client.id;

    // The card is held for the quote and the family signed the consent (stamped here; EMR-03 covers signing).
    emrApi(world, 'POST', `/visit-estimates/${estimateId}/accept`, { practiceId: world.practiceId });
    emrApi(world, 'POST', `/visit-estimates/${estimateId}/authorize`, { practiceId: world.practiceId }).then((res) => {
      expect(res.status, JSON.stringify(res.body)).to.be.lessThan(300);
      expect(res.body.lastChargeStatus).to.eq('requires_capture');
      expect(Number(res.body.authorizedAmount)).to.eq(475);
    });
    emrSql(
      `INSERT INTO consent_response ("inviteId", answers, "signatureDataUrl", "signedAt", "signedName")
       VALUES (${consentInviteId}, '{"petName":"Pippin"}'::jsonb, 'data:image/png;base64,AAAA', now(), 'Wren Fairweather')`,
    );
    emrSql(`UPDATE consent_invite SET "respondedAt" = now() WHERE id = ${consentInviteId}`);

    // Checkout: the estimate shows the hold; the family says no.
    signIn(world, `/schedule/soap/${appointmentId}/${patientId}/checkout?clientId=${clientId}`);
    cy.contains('Estimate given to the family', { timeout: 40000 }).should('be.visible');
    cy.contains('$475.00 is held on their card').should('exist');
    cy.contains('button', 'Family declined').click();
    cy.contains('The $475.00 hold comes off their card').should('exist');
    cy.contains('button', 'Yes, the family declined').click();

    cy.get('[data-testid="estimate-settle-notice"]', { timeout: 30000 })
      .should('contain.text', 'hold was released and nothing was charged');
    cy.contains('Estimate given to the family').should('not.exist');
    cy.contains('button', 'Convert to invoice & take payment').should('not.exist');

    // Staff cancel the visit (the scheduler's Cancel sets this status).
    emrSql(`UPDATE appointments SET "confirmStatusName" = 'Canceled Appointment' WHERE id = ${appointmentId}`);

    // The quote is declined with no live hold; the consent is withdrawn.
    emrApi(world, 'GET', `/visit-estimates/${estimateId}?practiceId=${world.practiceId}`).then((res) => {
      expect(res.status).to.eq(200);
      expect(res.body.status).to.eq('declined');
      expect(res.body.lastChargeStatus).not.to.eq('requires_capture');
      expect(res.body.convertedInvoiceId).to.eq(null);
    });
    emrApi(world, 'GET', `/consent/euthanasia/status?appointmentId=${appointmentId}&patientId=${patientId}`).then((res) => {
      expect(res.status).to.eq(200);
      expect(res.body.invite.withdrawnAt).to.be.a('string');
    });
    emrApi(world, 'GET', `/consent/euthanasia/statuses?appointmentIds=${appointmentId}`).then((res) => {
      expect(res.body.statuses[appointmentId]).to.eq('withdrawn');
    });

    // No bill: nothing was converted and nothing was paid for this visit.
    emrSql(
      `SELECT count(*) FROM visit_invoices i JOIN visit_invoice_appointments va ON va."invoiceId" = i.id
        WHERE va."appointmentId" = ${appointmentId} AND i."isDeleted" = false AND (i."amountPaid" > 0 OR i.total > 0)`,
    ).then((n) => expect(Number(n)).to.eq(0));
    emrSql(
      `SELECT count(*) FROM visit_invoice_tenders t JOIN visit_invoice_appointments va ON va."invoiceId" = t."invoiceId"
        WHERE va."appointmentId" = ${appointmentId}`,
    ).then((n) => expect(Number(n)).to.eq(0));

    // The consent link can't be signed again.
    cy.visit(world.euthanasia.consentPath);
    cy.contains(/withdrawn/i, { timeout: 30000 }).should('exist');

    // Reloading checkout shows no estimate to collect and no charge.
    signIn(world, `/schedule/soap/${appointmentId}/${patientId}/checkout?clientId=${clientId}`);
    cy.contains('button', 'Convert to invoice & take payment').should('not.exist');
    cy.contains('$475.00 is held on their card').should('not.exist');
  });
});

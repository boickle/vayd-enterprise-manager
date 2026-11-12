/// <reference types="cypress" />
import '../support/e2e';
import { cleanEmrWorld, emrApi, seedEmrWorld, type EmrWorld } from '../support/emrWorld';

/**
 * Owner decisions of Nov 3, 2026 (round 2) on screen:
 *  - NOV3-4: once the euthanasia visit is checked out, the family's consent link shows
 *    "This visit has already been checked out. Please contact the practice." and nothing is recorded.
 *  - NOV3-5: an ordinary visit's estimate is informational at checkout: no card, no authorization
 *    bubble, no "Run Payment from Authorization".
 *
 *   EMR_DB=vayd_api_test CYPRESS_EMR_DB=vayd_api_test npx cypress run --spec cypress/e2e/emr-w10b-checkout-consent.cy.ts
 *
 * The dev API must use the same test database.
 */

function signIn(world: EmrWorld, path: string) {
  cy.visit('/login');
  cy.window().then((win) => {
    win.localStorage.clear();
    win.localStorage.setItem('accessToken', world.staff.token);
  });
  cy.visit(path);
}

describe('NOV3-4: consent after checkout is refused', () => {
  let world: EmrWorld;
  before(() => seedEmrWorld().then((w) => (world = w)));
  after(() => cleanEmrWorld());

  it('the link says the visit was checked out; nothing is recorded', () => {
    const { appointmentId, patientId, estimateId, consentPath } = world.euthanasia;
    // Card taken by phone, held, and staff ran the payment at checkout.
    emrApi(world, 'POST', `/visit-estimates/${estimateId}/accept`, { practiceId: world.practiceId });
    emrApi(world, 'POST', `/visit-estimates/${estimateId}/authorize`, { practiceId: world.practiceId }).then((res) =>
      expect(res.status, JSON.stringify(res.body)).to.be.lessThan(300),
    );
    signIn(world, `/schedule/soap/${appointmentId}/${patientId}/checkout?clientId=${world.client.id}`);
    cy.contains('button', 'Run Payment from Authorization', { timeout: 40000 }).should('not.be.disabled').click();
    cy.contains('Estimate given to the family', { timeout: 30000 }).should('not.exist');

    cy.visit(consentPath);
    cy.contains('This visit has already been checked out. Please contact the practice.', { timeout: 30000 }).should('be.visible');
    cy.get('form').should('not.exist');

    emrApi(world, 'GET', `/consent/euthanasia/status?appointmentId=${appointmentId}&patientId=${patientId}`).then((res) => {
      expect(res.status).to.eq(200);
      expect(res.body.invite?.respondedAt ?? null).to.eq(null);
    });
  });
});

describe('NOV3-5: an ordinary visit estimate is informational at checkout', () => {
  let world: EmrWorld;
  before(() => seedEmrWorld().then((w) => (world = w)));
  after(() => cleanEmrWorld());

  it('no card, hold, bubble or payment button for it', () => {
    const { appointmentId, patientId } = world.visit;
    emrApi(world, 'POST', '/visit-estimates/for-appointment', {
      practiceId: world.practiceId,
      appointmentId,
      patientId,
      clientId: world.client.id,
    }).then((est) => {
      expect(est.status).to.be.lessThan(300);
      expect(est.body.isEuthanasia).to.eq(false);
      emrApi(world, 'POST', `/visit-estimates/${est.body.id}/lines`, {
        practiceId: world.practiceId,
        patientId,
        description: 'Dental cleaning',
        qty: 1,
        unitPrice: 300,
      });
      emrApi(world, 'POST', `/visit-estimates/${est.body.id}/authorize`, { practiceId: world.practiceId }).then((res) => {
        expect(res.status).to.eq(400);
        expect(String(res.body.message)).to.match(/Only euthanasia estimates take a card authorization/);
      });
    });

    signIn(world, `/schedule/soap/${appointmentId}/${patientId}/checkout?clientId=${world.client.id}`);
    cy.get('[data-testid="estimate-settle-informational"]', { timeout: 40000 }).should('exist');
    cy.contains('For information only: no card is held for this estimate.').should('exist');
    cy.contains('button', 'Run Payment from Authorization').should('not.exist');
    cy.get('[data-testid="estimate-authorization-bubble"]').should('not.exist');
    cy.get('[data-testid="estimate-settle-informational"]').within(() => {
      cy.contains('button', 'Take card').should('not.exist');
      cy.contains('button', 'Authorize now').should('not.exist');
    });
  });
});

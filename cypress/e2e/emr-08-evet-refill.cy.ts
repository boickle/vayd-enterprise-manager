/// <reference types="cypress" />
import '../support/e2e';
import { cleanEmrWorld, emrApi, seedEmrWorld, type EmrWorld } from '../support/emrWorld';

/**
 * EMR-08-6: an eVet prescription is refillable at checkout. The seeded world has an eVet Rx for Carprofen on
 * Juniper (3 refills) that, like every eVet import, carries no pet or item: it reaches Juniper only through her
 * eVet treatment line (planItem_Id). Staff add Carprofen to Juniper's open invoice in Billing, open
 * "Check refills", see the eVet Rx and use it. One refill comes off and the directions are copied and locked.
 *
 *   EMR_DB=vayd_api_test CYPRESS_EMR_DB=vayd_api_test npx cypress run --spec cypress/e2e/emr-08-evet-refill.cy.ts
 *
 * The dev API must use the same test database. Nothing is charged or sent.
 */

function signIn(world: EmrWorld, path: string) {
  cy.visit('/login');
  cy.window().then((win) => {
    win.localStorage.clear();
    win.localStorage.setItem('accessToken', world.staff.token);
  });
  cy.visit(path);
}

type Line = {
  id: string;
  catalogItemId: number | null;
  patientId: number | null;
  instructions: string | null;
  refillOfPrescriptionId: number | null;
  refillCount: number | null;
  isDeleted?: boolean;
};

describe('EMR-08-6: eVet prescription refill at checkout', () => {
  let world: EmrWorld;

  before(() => seedEmrWorld().then((w) => (world = w)));
  after(() => cleanEmrWorld());

  it('staff add Carprofen, open Check refills, use the eVet Rx: refills 3 → 2 and the directions lock', () => {
    const rx = world.evetRx;
    signIn(world, `/schedule/clients?clientId=${world.client.id}&tab=financial&invoice=${world.visit.invoiceId}`);

    // Add Carprofen to Juniper's open invoice.
    cy.get(`input[placeholder="Add a charge for ${rx.petName}"]`, { timeout: 40000 }).first().click().type(rx.itemName);
    cy.contains('button', rx.itemName, { timeout: 20000 }).click();
    // The invoice table has a sticky header row and the page a fixed app header; Cypress's default scroll puts the
    // button at the top edge, under them. Centre it in the scrolling area instead (no force needed).
    // The button sits inside the invoice panel's own scroll area; bring it into view there first.
    cy.viewport(1440, 1000);
    cy.contains('button', 'Check refills', { timeout: 20000 })
      .should('exist')
      .scrollIntoView({ offset: { top: -250, left: 0 } })
      .should('be.visible')
      .click();

    // The picker lists the eVet Rx with its refills and directions.
    cy.contains('.inv-refill h3', `Refills for ${rx.itemName}`, { timeout: 20000 });
    cy.contains('.inv-refill__row', `Rx #${rx.rxNumber}`, { timeout: 20000 })
      .should('contain.text', `${rx.refills} refills left`)
      .and('contain.text', rx.instructions)
      .and('contain.text', 'Marguerite Oakhollow')
      .within(() => cy.contains('button', 'Use this refill').click());

    // The line is now a refill: directions locked to the prescription, one refill used.
    cy.contains('.inv-refill__summary', `Refill of Rx #${rx.rxNumber}`, { timeout: 20000 })
      .should('contain.text', `${rx.refills - 1} refills left after this`)
      .and('contain.text', 'Directions are locked to the prescription.');

    emrApi(world, 'GET', `/visit-invoices/${world.visit.invoiceId}?practiceId=${world.practiceId}`).then((res) => {
      expect(res.status).to.eq(200);
      const line = (res.body.lines as Line[]).find(
        (l) => Number(l.catalogItemId) === rx.itemId && Number(l.patientId) === rx.patientId && !l.isDeleted,
      );
      expect(line, 'Carprofen line').to.exist;
      expect(line!.refillOfPrescriptionId).to.eq(rx.prescriptionId);
      expect(line!.instructions).to.eq(rx.instructions);
      expect(Number(line!.refillCount)).to.eq(rx.refills - 1);

      // Changing the directions on a refill line is refused.
      emrApi(world, 'PATCH', `/visit-invoices/${world.visit.invoiceId}/lines/${line!.id}`, {
        practiceId: world.practiceId,
        instructions: 'Give 2 caplets once daily.',
      }).then((edit) => {
        expect(edit.status).to.eq(400);
        expect(String(edit.body.message)).to.match(/locked/i);
      });

      emrApi(
        world,
        'GET',
        `/visit-invoices/${world.visit.invoiceId}/lines/${line!.id}/refill-options?practiceId=${world.practiceId}`,
      ).then((opts) => {
        const used = (opts.body as Array<{ prescriptionId: number; usedOnThisLine: boolean; refillsLeft: number }>).find(
          (o) => o.prescriptionId === rx.prescriptionId,
        );
        expect(used).to.include({ usedOnThisLine: true, refillsLeft: rx.refills - 1 });
      });
    });
  });
});

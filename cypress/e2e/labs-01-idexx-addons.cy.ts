/// <reference types="cypress" />
import '../support/e2e';
import { cleanLabsWorld, labsApi, labsItemName, labsSoapPath, labsWorld, seedLabsWorld, signInLabs, type LabsHousehold } from '../support/labsWorld';

/**
 * LAB-01-6 and LAB-02-4 (docs/test-plans/labs.md): tests added inside IDEXX's order page land on the bill once,
 * at the client's price.
 *
 * Needs the coordinator's stack: the API started with IDEXX_FAKE_STATE=<file> (Cypress.env('IDEXX_FAKE_STATE')),
 * on the Labs world's test database. Run: npx cypress run --spec cypress/e2e/labs-01-idexx-addons.cy.ts
 */
type Line = { id: string; description: string; unitPrice: number | string; amount: number | string; isDeleted?: boolean; catalogItemId?: number | null };
type Bill = { id: string; subtotal: number | string; total?: number | string; lines: Line[] };

const fakeState = (state: Record<string, unknown>) => cy.writeFile(Cypress.env('IDEXX_FAKE_STATE'), state);

/** A SOAP visit for the household's first pet with Chem 25 on the plan, sent to IDEXX (not submitted). */
function visitWithChem25(h: LabsHousehold, chem25Price: number) {
  const w = labsWorld();
  const pet = h.pets[0];
  return labsApi<{ id: string }>('veterinarian', 'POST', '/soap-encounters', {
    practiceId: w.practiceId,
    appointmentId: pet.appointmentId,
    patientId: pet.patientId,
    clientId: h.clientId,
  }).then((enc) =>
    labsApi('veterinarian', 'POST', `/soap-encounters/${enc.id}/orders`, {
      practiceId: w.practiceId,
      name: labsItemName('Chem 25 (IDEXX)'),
      kind: 'diagnostic',
      catalogItemType: 'lab',
      catalogItemId: w.labs.chem25Id,
      qty: 1,
      unitPrice: chem25Price,
      state: 'accepted',
    })
      .then(() => labsApi<Bill>('veterinarian', 'GET', `/visit-invoices/by-appointment/${pet.appointmentId}?practiceId=${w.practiceId}`))
      .then((bill) =>
        labsApi('veterinarian', 'POST', `/idexx/invoices/${bill.id}/orders`, { patientId: pet.patientId }).then(() => bill.id),
      ),
  );
}

const bill = (h: LabsHousehold) =>
  labsApi<Bill>('veterinarian', 'GET', `/visit-invoices/by-appointment/${h.pets[0].appointmentId}?practiceId=${labsWorld().practiceId}`);
const uaLines = (b: Bill) => b.lines.filter((l) => !l.isDeleted && Number(l.catalogItemId) === labsWorld().labs.uaId);

/** Doctor opens Finish in IDEXX on checkout, stays while Scout polls (IDEXX slow), then closes. */
function finishInIdexx(h: LabsHousehold) {
  signInLabs('veterinarian', labsSoapPath(h.pets[0], h.clientId, '/checkout'));
  cy.contains('h1', 'Checkout', { timeout: 30000 });
  // The IDEXX panel (with its Finish in IDEXX button) sits in the lab line's expanded drawer.
  cy.get('button.soap-invoice-line-expand[aria-expanded="false"]', { timeout: 30000 }).first().click();
  cy.contains('button', 'Finish in IDEXX', { timeout: 30000 }).click();
  cy.get('.idexx-frame', { timeout: 10000 }).should('be.visible');
  // Opening refresh plus at least two polls, each answered slowly by the fake.
  cy.wait(30000);
  cy.get('.idexx-frame').contains('button', 'Close').click();
  cy.get('.idexx-frame').should('not.exist');
}

describe('LAB-01 / LAB-02: IDEXX add-ons on the bill', () => {
  before(() => {
    seedLabsWorld();
  });
  afterEach(() => {
    fakeState({});
  });
  after(() => {
    cleanLabsWorld();
  });

  it('LAB-01-6: UA added in IDEXX while the frame is open, slow IDEXX: one UA charge, right total, one note', () => {
    const h = labsWorld().households.two;
    fakeState({ addTests: { '*': ['UA'] }, latencyByMethod: { getOrder: 4000 } });
    visitWithChem25(h, 120);
    finishInIdexx(h);

    bill(h).then((b) => {
      expect(uaLines(b), 'UA lines').to.have.length(1);
      expect(Number(uaLines(b)[0].unitPrice)).to.be.closeTo(55, 0.005);
      expect(Number(b.subtotal)).to.be.closeTo(175, 0.005);
    });
    cy.get('.idexx-order__note--ok').filter(':contains("Added to the bill from IDEXX")').should('have.length', 1);
  });

  it('LAB-02-4: staff pet: the IDEXX add-on is charged the staff price and checkout totals it', () => {
    const h = labsWorld().households.staff;
    fakeState({ addTests: { '*': ['UA'] } });
    // Chem 25 at its own staff price ($60); UA at the practice IDEXX staff price (50% off $55).
    visitWithChem25(h, 60);
    finishInIdexx(h);

    bill(h).then((b) => {
      expect(uaLines(b), 'UA lines').to.have.length(1);
      expect(Number(uaLines(b)[0].unitPrice)).to.be.closeTo(27.5, 0.005);
      expect(Number(b.subtotal)).to.be.closeTo(87.5, 0.005);
    });
    cy.contains('.soap-invoice-row.total', 'Total', { timeout: 30000 }).should('contain.text', '$87.50');
  });
});

/// <reference types="cypress" />
import '../support/e2e';
import {
  cleanLabsWorld,
  labsApi,
  labsWorld,
  seedLabsWorld,
  signInLabs,
} from '../support/labsWorld';

/**
 * LAB-04-6 and LAB-04-7 (written, not run): who sees Mark reviewed, and the reason a tech gives.
 * Needs the Labs stack: API started with IDEXX_FAKE_STATE=<file> (Cypress.env('IDEXX_FAKE_STATE')).
 * Run: CYPRESS_LABS_DB=<test db> npx cypress run --spec cypress/e2e/labs-04-idexx-permissions.cy.ts
 */
const RESULTS_PATH = '/schedule/idexx-results';

function idexxResult(resultId: string, patientId: number, petName: string, clientLastName: string) {
  return {
    resultId,
    orderId: null,
    status: 'COMPLETE',
    modality: 'REFLAB',
    patient: { name: petName, clientLastName, patientId: String(patientId) },
    categories: [
      {
        name: 'Chemistry',
        tests: [
          {
            name: 'Glucose',
            code: 'GLU',
            result: '95',
            resultNumeric: 95,
            units: 'mg/dL',
            status: 'COMPLETE',
          },
          {
            name: 'BUN',
            code: 'BUN',
            result: '20',
            resultNumeric: 20,
            units: 'mg/dL',
            status: 'COMPLETE',
          },
        ],
      },
    ],
    updatedDate: new Date().toISOString(),
  };
}

/** IDEXX hands out one complete result for Max; the sync stores it. Yields the stored result id. */
function storeMaxResult(): Cypress.Chainable<number> {
  const w = labsWorld();
  const max = w.households.two.pets.find((p) => p.name === 'Max')!;
  const resultId = `labs04-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  cy.writeFile(Cypress.env('IDEXX_FAKE_STATE'), {
    results: [idexxResult(resultId, max.patientId, max.name, 'Labtest')],
  });
  labsApi('technician', 'POST', '/idexx/results/sync');
  cy.writeFile(Cypress.env('IDEXX_FAKE_STATE'), {});
  return labsApi<{ items: Array<{ id: number; idexxResultId: string }> }>(
    'technician',
    'GET',
    `/idexx/results?patientId=${max.patientId}&limit=50`
  ).then((res) => res.items.find((i) => i.idexxResultId === resultId)!.id);
}

function openMax() {
  cy.get('.idexx-result-list__row', { timeout: 30000 })
    .first()
    .find('button[aria-label^="Expand"]')
    .click();
}

describe('LABS-04: IDEXX review permissions on screen', () => {
  before(() => {
    seedLabsWorld();
  });
  after(() => {
    cleanLabsWorld();
  });

  it('LAB-04-6: a client liaison sees no Mark reviewed button and can still open the PDF', () => {
    storeMaxResult();
    signInLabs('client_liaison', RESULTS_PATH);
    openMax();
    cy.contains('.idexx-result__actions button', 'PDF', { timeout: 30000 }).should('be.visible');
    cy.contains('button', 'Mark reviewed').should('not.exist');
    cy.contains('button', 'Approve wording').should('not.exist');
  });

  it('LAB-04-7: a tech must pick a reason; afterwards the result shows who reviewed it and why', () => {
    storeMaxResult().then((resultId) => {
      signInLabs('technician', RESULTS_PATH);
      openMax();
      cy.contains('button', 'Mark reviewed', { timeout: 30000 }).click();
      cy.get('[data-testid="idexx-reason-prompt"]').within(() => {
        cy.contains('button', 'Mark reviewed').should('be.disabled');
        cy.contains('vet to sign later').should('not.exist');
        cy.contains('label', 'Vet reviewed verbally').find('input').check();
        cy.contains('button', 'Mark reviewed').should('not.be.disabled').click();
      });
      // The API stored who and why.
      labsApi<{
        reviewedAt: string | null;
        reviewedReason: string | null;
        reviewedByName: string | null;
      }>('technician', 'GET', `/idexx/results/${resultId}`).then((r) => {
        expect(r.reviewedAt).to.be.a('string');
        expect(r.reviewedReason).to.equal('Vet reviewed verbally');
        expect(r.reviewedByName).to.be.a('string');
      });
      // It leaves "Needs review"; under All recent the line reads "Reviewed … by (tech) — reason".
      cy.contains('[role="tab"]', 'All recent').click();
      openMax();
      cy.get('[data-testid="idexx-reviewed-by"]', { timeout: 30000 }).should(
        'contain.text',
        'Vet reviewed verbally'
      );
    });
  });
});

/// <reference types="cypress" />
import '../support/e2e';
import { cleanLabsWorld, labsApi, labsItemName, labsWorld, PENDING_LABS_PATH, seedLabsWorld, signInLabs } from '../support/labsWorld';

/**
 * LAB-07-4 (written, not run): the 4Dx line is moved from Max to Bella on the bill; the pending result
 * then shows for Bella on the Pending Labs worklist and never for Max.
 * Needs the Labs stack (API on the Labs test database). Run: npx cypress run --spec cypress/e2e/labs-07-line-moved.cy.ts
 */
type Bill = { id: string; lines: Array<{ id: string; catalogItemId?: number | null; isDeleted?: boolean }> };

describe('LAB-07: a lab line moved to another pet', () => {
  before(() => {
    seedLabsWorld();
  });
  after(() => {
    cleanLabsWorld();
  });

  it('LAB-07-4: move the 4Dx line from Max to Bella; the result is Bella\'s only', () => {
    const w = labsWorld();
    const hh = w.households.two;
    const max = hh.pets.find((p) => p.name === 'Max')!;
    const bella = hh.pets.find((p) => p.name === 'Bella')!;
    const form = labsItemName('HEARTWORM 4DX PLUS');

    labsApi<Bill>('veterinarian', 'POST', '/visit-invoices/counter', {
      practiceId: w.practiceId,
      patientId: max.patientId,
      clientId: hh.clientId,
    })
      .then((bill) =>
        labsApi<Bill>('veterinarian', 'POST', `/visit-invoices/${bill.id}/lines`, {
          practiceId: w.practiceId,
          patientId: max.patientId,
          description: 'Heartworm 4Dx',
          qty: 1,
          unitPrice: 40,
          catalogItemType: 'lab',
          catalogItemId: w.labs.heartworm4dxId,
        }).then((b) => ({ id: bill.id, line: b.lines.find((l) => !l.isDeleted && Number(l.catalogItemId) === w.labs.heartworm4dxId)! })),
      )
      .then(({ id, line }) =>
        // What the bill's line editor sends when staff pick Bella as the line's pet.
        labsApi('veterinarian', 'PATCH', `/visit-invoices/${id}/lines/${line.id}`, { practiceId: w.practiceId, patientId: bella.patientId }),
      );

    signInLabs('technician', PENDING_LABS_PATH);
    cy.get('.pending-labs__row-btn', { timeout: 30000 }).filter(':contains("Bella —")').filter(`:contains("${form}")`).should('have.length.at.least', 1);
    cy.get('.pending-labs__row-btn').filter(':contains("Max —")').filter(`:contains("${form}")`).should('have.length', 0);

    // Enter the result on Bella's row; it saves on Bella.
    cy.get('.pending-labs__row-btn').filter(':contains("Bella —")').filter(`:contains("${form}")`).first().click();
    cy.get('.lab-panel__sheet').should('contain.text', 'Bella');
  });
});

/// <reference types="cypress" />
import '../support/e2e';
import { cleanLabsWorld, labsApi, labsItemName, labsWorld, PENDING_LABS_PATH, seedLabsWorld, signInLabs } from '../support/labsWorld';

/**
 * LAB-08-4 (written, not run): the client declines 4Dx at checkout; the line comes off the bill and the
 * pending form is gone from Pending Labs.
 * Needs the Labs stack (API on the Labs test database). Run: npx cypress run --spec cypress/e2e/labs-08-pending-removed.cy.ts
 */
type Bill = { id: string; lines: Array<{ id: string; catalogItemId?: number | null; isDeleted?: boolean }> };

describe('LAB-08: pending forms after the charge is removed', () => {
  before(() => {
    seedLabsWorld();
  });
  after(() => {
    cleanLabsWorld();
  });

  it('LAB-08-4: remove the 4Dx line, open Pending Labs: not listed', () => {
    const w = labsWorld();
    const hh = w.households.two;
    const max = hh.pets.find((p) => p.name === 'Max')!;
    const form = 'HEARTWORM 4DX PLUS'; // form names aren't tagged per run; the row's pet name scopes it

    labsApi<Bill>('veterinarian', 'POST', '/visit-invoices/counter', {
      practiceId: w.practiceId,
      patientId: max.patientId,
      clientId: hh.clientId,
    }).then((bill) =>
      labsApi<Bill>('veterinarian', 'POST', `/visit-invoices/${bill.id}/lines`, {
        practiceId: w.practiceId,
        patientId: max.patientId,
        description: 'Heartworm 4Dx',
        qty: 1,
        unitPrice: 40,
        catalogItemType: 'lab',
          providerEmployeeId: w.employees.veterinarian,
        catalogItemId: w.labs.heartworm4dxId,
      }).then((b) => {
        const line = b.lines.find((l) => !l.isDeleted && Number(l.catalogItemId) === w.labs.heartworm4dxId)!;
        signInLabs('technician', PENDING_LABS_PATH);
        cy.get('.pending-labs__row-btn', { timeout: 30000 }).filter(`:contains("${form}")`).should('have.length.at.least', 1);
        // Declined at checkout: the line comes off the bill.
        labsApi('veterinarian', 'DELETE', `/visit-invoices/${bill.id}/lines/${line.id}?practiceId=${w.practiceId}`);
        cy.reload();
        cy.get('.pending-labs', { timeout: 30000 }).should('exist');
        // None of Max's 4Dx rows may remain (the list may be empty, so look inside the page rather than for rows).
        cy.get('.pending-labs').should(($page) => {
          expect($page.find(`.pending-labs__row-btn:contains("Max —"):contains("${form}")`)).to.have.length(0);
        });
      }),
    );
  });
});

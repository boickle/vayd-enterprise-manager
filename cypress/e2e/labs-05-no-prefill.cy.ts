/// <reference types="cypress" />
import '../support/e2e';
import { PENDING_LABS_PATH, cleanLabsWorld, labsApi, labsItemName, labsWorld, seedLabsWorld, signInLabs } from '../support/labsWorld';

/**
 * LAB-05-4 (written, not run): a Schirmer charge opens a blank form in Pending Labs. Save results with
 * nothing typed is refused; after entering 18 and 17 it saves and the row leaves the Waiting-to-run list.
 * Needs the Labs stack. Run: CYPRESS_LABS_DB=<test db> npx cypress run --spec cypress/e2e/labs-05-no-prefill.cy.ts
 */
describe('LABS-05: lab forms do not pre-fill', () => {
  before(() => {
    seedLabsWorld();
  });
  after(() => {
    cleanLabsWorld();
  });

  it('LAB-05-4: Schirmer opens blank, is refused untouched, saves after 18/17 and leaves Pending Labs', () => {
    const w = labsWorld();
    const h = w.households.two;
    const pet = h.pets[0];
    labsApi<{ id: string }>('veterinarian', 'POST', '/soap-encounters', {
      practiceId: w.practiceId,
      appointmentId: pet.appointmentId,
      patientId: pet.patientId,
      clientId: h.clientId,
    }).then((enc) =>
      labsApi('veterinarian', 'POST', `/soap-encounters/${enc.id}/orders`, {
        practiceId: w.practiceId,
        name: labsItemName('Schirmer Tear Test'),
        kind: 'procedure',
        catalogItemType: 'procedure',
        catalogItemId: w.procedures.schirmerId,
        qty: 1,
        unitPrice: 25,
        state: 'accepted',
      }),
    );
    // Opening the bill creates the pending form for the charged line.
    labsApi('veterinarian', 'GET', `/visit-invoices/by-appointment/${pet.appointmentId}?practiceId=${w.practiceId}`);

    signInLabs('technician', PENDING_LABS_PATH);
    cy.contains('.pending-labs__row-btn', `${pet.name} — Schirmer`, { timeout: 30000 }).click();

    cy.get('input[aria-label="OD value"]').should('have.value', '');
    cy.get('input[aria-label="OS value"]').should('have.value', '');
    cy.contains('button', 'Save results').click();
    cy.get('.lab-result-form__error', { timeout: 15000 }).should('contain.text', 'Still blank');
    cy.get('.lab-result-form').should('exist');

    cy.get('input[aria-label="OD value"]').type('18');
    cy.get('input[aria-label="OS value"]').type('17');
    cy.contains('button', 'Save results').click();
    cy.get('.lab-result-form', { timeout: 30000 }).should('not.exist');
    cy.contains('.pending-labs__row-btn', `${pet.name} — Schirmer`).should('not.exist');

    // The end-of-day task for the lab closes once it is resulted.
    labsApi<{ items: Array<{ title: string; status: string }> }>(
      'technician',
      'GET',
      `/tasks?patientId=${pet.patientId}&includeDone=true&limit=100`,
    ).then((res) => {
      const labTasks = res.items.filter((t) => /schirmer/i.test(t.title));
      expect(labTasks, 'Schirmer tasks').to.not.be.empty;
      labTasks.forEach((t) => expect(t.status, t.title).to.eq('done'));
    });
  });
});

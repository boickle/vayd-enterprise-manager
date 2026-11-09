/// <reference types="cypress" />
import '../../support/e2e';
import { signInAsScheduling } from '../../support/schedulingWorld';
import { counterBill } from '../invKit';
import { enrolPet, fileAgreement, pets, PLAN, resetMembershipWorld } from '../memKit';

describe('probe p07', () => {
  it('multi-pet credit', () => {
    const p = pets();
    resetMembershipWorld();
    enrolPet(p.maple, PLAN.dogFoundationsMonthly, { startDaysAgo: 60 });
    fileAgreement(p.maple, p.maria, 60);
    enrolPet(p.juniper, PLAN.catFoundationsMonthly, { startDaysAgo: 0.02 });
    fileAgreement(p.juniper, p.maria, 0);
    counterBill(p.juniper, p.maria, ['Revolution Plus for Cats 5.6-11lb']).then((id) => {
      signInAsScheduling('cl', `/schedule/clients?clientId=${p.maria}&tab=financial&invoice=${id}&patientId=${p.juniper}`);
    });
    cy.contains('Revolution Plus', { timeout: 60000 }).should('exist');
    cy.wait(4000);
    cy.screenshot('01-fin', { capture: 'viewport' });
    cy.document().then((d) => cy.writeFile(Cypress.env('PROBE_OUT') + '/fin.txt', d.body.innerText));
    cy.get('.client-fin__field--pay-method select').select('account_credit');
    cy.wait(2000);
    cy.get('.client-fin__field--pay-method select').scrollIntoView();
    cy.screenshot('02-credit', { capture: 'viewport' });
  });
});

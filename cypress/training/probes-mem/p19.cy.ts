/// <reference types="cypress" />
import '../../support/e2e';
import { enrolPet, fileAgreement, pets, PLAN, renewalLink, resetMembershipWorld } from '../memKit';

describe('probe p19', () => {
  it('renewal page', () => {
    const p = pets();
    resetMembershipWorld();
    enrolPet(p.maple, PLAN.dogFoundationsMonthly, { startDaysAgo: 358 }).then((id) => {
      fileAgreement(p.maple, p.maria, 358);
      renewalLink(id).then((path) => cy.visit(path));
    });
    cy.wait(8000);
    cy.screenshot('01-renewal', { capture: 'fullPage' });
    cy.document().then((d) => cy.writeFile(Cypress.env('PROBE_OUT') + '/page.txt', d.body.innerText));
  });
});

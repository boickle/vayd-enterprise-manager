/// <reference types="cypress" />
import '../../support/e2e';
import { signInAsScheduling } from '../../support/schedulingWorld';
import { chartUrl, enrolPet, fileAgreement, pets, PLAN, quietChart, resetMembershipWorld, useBenefits } from '../memKit';

describe('probe p14', () => {
  it('cancel preview', () => {
    const p = pets();
    resetMembershipWorld();
    enrolPet(p.maple, PLAN.dogFoundationsMonthly, { startDaysAgo: 120 }).then((id) =>
      useBenefits(id, [
        { name: 'Annual Wellness Visit', daysAgo: 100 },
        { name: 'Rabies Vaccine - 3 year', daysAgo: 100 },
        { name: 'DAPP (Distemper) Vaccine - 3 year', daysAgo: 100 },
        { name: 'Heartworm / Tick Test (4dx)', daysAgo: 100 },
        { name: 'Trip Fee', daysAgo: 100 },
      ])
    );
    fileAgreement(p.maple, p.maria, 120);
    signInAsScheduling('manager', chartUrl(p.maple));
    quietChart();
    cy.contains('.pims-detail__btn-danger', 'Cancel', { timeout: 60000 }).click();
    cy.get('.pmp-cancel', { timeout: 60000 }).should('exist');
    cy.wait(6000);
    cy.get('.pmp-cancel').scrollIntoView();
    cy.screenshot('01-cancel', { capture: 'viewport' });
    cy.get('.pmp-cancel').then(($c) => cy.writeFile(Cypress.env('PROBE_OUT') + '/cancel.txt', $c[0].innerText));
  });
});

/// <reference types="cypress" />
/**
 * Training video, MEM-01: is this pet a member? (docs/training/scripts/memberships/MEM-01-is-this-pet-a-member.md)
 * TEST stack, demo names only. Maple is on Canine Foundations (monthly), 40 days in, with a wellness visit, rabies,
 * DAPP and a 4Dx used; Juniper has no plan. Signed in as Casey Morgan (client liaison).
 */
import '../support/e2e';
import { signInAsScheduling } from '../support/schedulingWorld';
import { chartUrl, enrolPet, fileAgreement, pets, PLAN, quietChart, resetMembershipWorld, settle, useBenefits } from './memKit';
import { finish, line, loadNarration, pointAt, startClock, tap } from './trainingKit';

describe('Training: MEM-01 is this pet a member', () => {
  it('MEM-01', () => {
    const p = pets();
    loadNarration();
    resetMembershipWorld();
    enrolPet(p.maple, PLAN.dogFoundationsMonthly, { startDaysAgo: 40 }).then((id) => {
      useBenefits(id, [
        { name: 'Annual Wellness Visit', daysAgo: 25 },
        { name: 'Rabies Vaccine - 3 year', daysAgo: 25 },
        { name: 'DAPP (Distemper) Vaccine - 3 year', daysAgo: 25 },
        { name: 'Heartworm / Tick Test (4dx)', daysAgo: 25 },
      ]);
    });
    fileAgreement(p.maple, p.maria, 40);
    signInAsScheduling('cl', chartUrl(p.maple, false));
    cy.get('.pims-emr-title__heart', { timeout: 60000 }).should('exist');
    quietChart();
    cy.get('#pims-emr-membership').then(($b) => {
      if ($b.attr('aria-expanded') === 'true') cy.get('#pims-emr-membership').click();
    });
    cy.get('#pims-emr-membership').should('have.attr', 'aria-expanded', 'false');
    cy.window().then((win) => win.scrollTo(0, 0));
    cy.wait(1500);

    startClock();
    line('m01-01');
    line('m01-02');
    line('m01-03', () => pointAt(() => cy.get('.pims-emr-title__heart'), 3500));
    line('m01-04', () => pointAt(() => cy.get('.pims-emr-membership'), 3000));
    line('m01-05', () => pointAt(() => cy.get('.pims-emr-household__pets'), 5000));
    line('m01-06', () => {
      tap(() => cy.get('#pims-emr-membership'));
      cy.get('.pmp-summary__plan', { timeout: 30000 }).should('be.visible');
    });
    line('m01-07', () => pointAt(() => cy.get('.pmp-summary__head'), 3500));
    line('m01-08', () => pointAt(() => cy.get('.pmp-summary__fee-note'), 4000));
    line('m01-09', () => pointAt(() => cy.get('.pmp-summary .pims-detail__facts').first(), 5000));
    line('m01-10', () => pointAt(() => cy.get('.pmp-card-update'), 3000));
    line('m01-11', () => pointAt(() => cy.contains('.pmp-allowance__title', 'What Maple can use'), 3500));
    line('m01-12', () => pointAt(() => cy.contains('.pmp-allowance__row:not(.is-spent)', 'CV-Tier 1 Trip Fee').first(), 5000));
    line('m01-13', () => {
      const row = () => cy.contains('.pmp-allowance__row.is-spent', 'Annual Wellness Visit').first();
      settle(row);
      pointAt(row, 5000);
    });
    line('m01-14', () => pointAt(() => cy.contains('.pmp-allowance', 'Used this term'), 4000));
    line('m01-15', () => tap(() => cy.get('.pmp-audit__toggle')));
    line('m01-16', () => pointAt(() => cy.get('.pmp-audit__list'), 4000));
    line('m01-17', () => {
      tap(() => cy.contains('a.pims-emr-household__pet', 'Juniper'));
      cy.contains('is not on a membership plan', { timeout: 30000 }).should('exist');
    });
    line('m01-18', () => pointAt(() => cy.contains('.pmp-muted', 'is not on a membership plan'), 3000));
    line('m01-19', () => pointAt(() => cy.get('.pmp-empty__actions'), 5000));
    line('m01-20');
    finish();
  });
});

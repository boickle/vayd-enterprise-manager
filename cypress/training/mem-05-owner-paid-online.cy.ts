/// <reference types="cypress" />
/**
 * Training video, MEM-05: owner signed up online, refund the visit (docs/training/scripts/memberships/MEM-05-owner-paid-online.md).
 * TEST stack on Stripe TEST mode, demo names only. Juniper had a paid wellness visit this morning; Maria then joined
 * Feline Foundations monthly online (a real test-mode subscription, started now). Casey Morgan (client liaison)
 * refunds the covered part of the visit.
 */
import '../support/e2e';
import { signInAsScheduling } from '../support/schedulingWorld';
import { chartUrl, enrolPet, fileAgreement, paidVisit, pets, PLAN, quietChart, resetMembershipWorld, settle, trace } from './memKit';
import { sql } from './memKit';
import { finish, line, loadNarration, offCamera, pointAt, startClock, tap } from './trainingKit';

describe('Training: MEM-05 owner paid online', () => {
  it('MEM-05', () => {
    const p = pets();
    loadNarration();
    trace('setup');
    resetMembershipWorld();
    paidVisit(p.juniper, p.maria, [
      'Annual Wellness Visit',
      'Trip Fee',
      'FVRCP (Distemper) Vaccine - 3 year',
      'Rabies Feline Vaccine (Purevax) - 1 year',
      'Revolution Plus for Cats 5.6-11lb',
    ], 240);
    enrolPet(p.juniper, PLAN.catFoundationsMonthly, { startDaysAgo: 0.02 });
    // An online signup has no enrolling employee (enrolPet goes through the staff API); Scout offers
    // "Owner paid — refund visit" only for those (Nov 10, 2026).
    cy.then(() => sql(`UPDATE wellness_plans SET "createdByEmployeeId"=NULL WHERE "patientId"=${p.juniper} AND "isDeleted"=false`));
    fileAgreement(p.juniper, p.maria, 0);
    signInAsScheduling('cl', chartUrl(p.juniper));
    quietChart();
    cy.contains('button', 'Owner paid — refund visit', { timeout: 60000 }).should('be.visible');
    cy.wait(1500);

    trace('clock');
    startClock();
    trace('m05-01'); line('m05-01');
    trace('m05-02'); line('m05-02');
    trace('m05-03'); line('m05-03', () => pointAt(() => cy.get('.pmp-summary'), 5000));
    trace('m05-04'); line('m05-04', () => {
      tap(() => cy.contains('button', 'Owner paid — refund visit'));
      cy.get('.pmp-confirm').should('exist');
    });
    trace('m05-05'); line('m05-05', () => pointAt(() => cy.get('.pmp-confirm'), 5000));
    trace('m05-06'); line('m05-06', () => {
      tap(() => cy.contains('.pmp-confirm__go', 'Review the refund'));
      cy.get('.pvms-invoice-row', { timeout: 30000 }).should('exist');
      cy.wait(2500);
    });
    trace('m05-07'); line('m05-07', () => pointAt(() => cy.contains('.pvms-section', 'Owner already paid'), 5000));
    trace('m05-08'); line('m05-08', () => {
      tap(() => cy.get('.pvms-invoice-row input').first());
      cy.get('.pvms-invoice-row input').first().then(($i) => {
        if (!($i[0] as HTMLInputElement).checked) ($i[0] as HTMLInputElement).click();
      });
      cy.get('.pvms-invoice-row input').first().should('be.checked');
    });
    trace('m05-09'); line('m05-09', () => {
      tap(() => cy.contains('button', 'Calculate refund'));
      cy.get('.pvms-totals', { timeout: 60000 }).should('exist');
    });
    trace('m05-10'); line('m05-10', () => {
      settle(() => cy.get('.pvms-owner-sees'));
      pointAt(() => cy.get('.pvms-owner-sees'), 5000);
    });
    trace('m05-11'); line('m05-11', () => {
      const t = () => cy.contains('h4, .pvms-lines__title', 'Covered by').first();
      settle(t);
      pointAt(() => t().parent(), 4000);
    });
    trace('m05-12'); line('m05-12', () => tap(() => cy.get('.pvms-foot .btn.primary')));
    offCamera(() => cy.get('.pvms-receipt', { timeout: 120000 }).should('exist'));
    trace('m05-13'); line('m05-13', () => pointAt(() => cy.get('.pvms-receipt'), 6000));
    trace('m05-13b'); line('m05-13b', () => {
      tap(() => cy.contains('.pvms-foot .btn.primary', 'Done'));
      cy.get('.pvms-modal').should('not.exist');
    });
    trace('m05-14'); line('m05-14');
    trace('done');
    finish();
  });
});

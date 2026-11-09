/// <reference types="cypress" />
/**
 * Training video, MEM-14: cancel a membership and settle paid vs used (docs/training/scripts/memberships/MEM-14-cancel-and-settle.md).
 * TEST stack on Stripe TEST mode, demo names only. Maple is on Canine Foundations monthly (test subscription, one
 * $69 invoice paid), no covered services used yet. Robin Hale (practice manager) cancels with a $69 refund.
 */
import '../support/e2e';
import { signInAsScheduling } from '../support/schedulingWorld';
import { chartUrl, enrolPet, fileAgreement, pets, PLAN, quietChart, resetMembershipWorld, settle, trace } from './memKit';
import { finish, line, loadNarration, offCamera, pointAt, startClock, tap, typeSlowly } from './trainingKit';

describe('Training: MEM-14 cancel and settle', () => {
  it('MEM-14', () => {
    const p = pets();
    loadNarration();
    trace('setup');
    resetMembershipWorld();
    enrolPet(p.maple, PLAN.dogFoundationsMonthly, { startDaysAgo: 120 });
    fileAgreement(p.maple, p.maria, 120);
    signInAsScheduling('manager', chartUrl(p.maple));
    quietChart();
    cy.contains('.pims-detail__btn-danger', 'Cancel', { timeout: 60000 }).should('be.visible');
    settle(() => cy.get('.pmp-summary'));
    cy.wait(1000);

    trace('clock');
    startClock();
    trace('m14-01'); line('m14-01');
    trace('m14-02'); line('m14-02');
    trace('m14-03'); line('m14-03', () => {
      tap(() => cy.contains('.pims-detail__btn-danger', 'Cancel'));
      cy.get('.pmp-cancel-totals', { timeout: 90000 }).should('exist');
      cy.contains('Working out this term').should('not.exist');
      cy.wait(800);
    });
    trace('m14-04'); line('m14-04', () => pointAt(() => cy.get('.pmp-owner-sees'), 5000));
    trace('m14-05'); line('m14-05', () => pointAt(() => cy.get('.pmp-cancel-totals'), 6000));
    trace('m14-06'); line('m14-06', () => pointAt(() => cy.get('.pmp-cancel-lines').first(), 4500));
    trace('m14-07'); line('m14-07', () => pointAt(() => cy.get('.pmp-refund-exception'), 6000));
    trace('m14-08'); line('m14-08', () => typeSlowly(() => cy.get('.pmp-cancel textarea'), 'Moving out of the service area'));
    trace('m14-09'); line('m14-09', () => {
      tap(() => cy.contains('.pmp-cancel .pims-detail__btn-danger', 'Cancel membership'));
      cy.contains('[role="dialog"], [role="alertdialog"]', 'Cancel ').should('exist');
    });
    trace('m14-10'); line('m14-10', () => pointAt(() => cy.contains('[role="dialog"], [role="alertdialog"]', 'ends now'), 5000));
    trace('m14-11'); line('m14-11', () => tap(() => cy.contains('[role="dialog"] button, [role="alertdialog"] button', /^Cancel membership$/)));
    offCamera(() => {
      cy.contains('Cancellation settlement', { timeout: 120000 }).should('exist');
      cy.wait(1500);
    });
    trace('m14-12'); line('m14-12', () => {
      settle(() => cy.contains('Cancellation settlement'));
      pointAt(() => cy.contains('Cancellation settlement').closest('table, div[class*="lines"]'), 6000);
    });
    trace('m14-13'); line('m14-13');
    trace('done');
    finish();
  });
});

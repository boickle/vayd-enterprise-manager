/// <reference types="cypress" />
/**
 * Training video, MEM-14: cancel a membership and settle paid vs used (docs/training/scripts/memberships/MEM-14-cancel-and-settle.md).
 * TEST stack on Stripe TEST mode, demo names only. Maple joined Canine Foundations monthly 20 days ago (one $69
 * payment) and had a paid wellness visit 10 days ago whose covered services are worth more than $69. Robin Hale
 * (practice manager) cancels: the difference is owed and charged (owner review, Nov 10, 2026).
 */
import '../support/e2e';
import { schedulingApi, schedulingWorld, signInAsScheduling } from '../support/schedulingWorld';
import { giveSavedCard, openVisit, setBillBranch, sql } from './invKit';
import { addChargesOnScreen, chartUrl, enrolPet, fileAgreement, pets, PLAN, quietChart, resetMembershipWorld, settle, trace } from './memKit';
import { finish, line, loadNarration, offCamera, pointAt, startClock, tap, typeSlowly } from './trainingKit';

describe('Training: MEM-14 cancel and settle', () => {
  it('MEM-14', () => {
    const p = pets();
    loadNarration();
    trace('setup');
    resetMembershipWorld();
    const w = schedulingWorld();
    enrolPet(p.maple, PLAN.dogFoundationsMonthly, { startDaysAgo: 20 });
    fileAgreement(p.maple, p.maria, 20);
    giveSavedCard(p.maria, 'maria.rivera@example.com', 'Maria Rivera');
    // A wellness visit 10 days ago, charged through the screen so the plan covers it, then paid.
    // Earlier takes left a visit at the same time 10 days back; clear Maple's old demo visits so the new one fits.
    cy.then(() => sql(`UPDATE appointments SET "isDeleted"=true WHERE "patientId"=${p.maple} AND "appointmentStart" < now() - interval '1 day'`));
    let appt = 0;
    let invoiceId = '';
    openVisit(p.maple, p.maria, 'Wellness visit', 10 * 24 * 60).then(({ appt: a }) => {
      appt = a;
      schedulingApi<{ id: string }>('cl', 'POST', '/visit-invoices', { practiceId: w.practiceId, appointmentId: a, clientId: p.maria }).then((inv) => {
        invoiceId = inv.body.id;
      });
      setBillBranch(p.maria);
    });
    cy.then(() => signInAsScheduling('doctorA', `/schedule/soap/${appt}/${p.maple}?clientId=${p.maria}`));
    cy.contains('.soap-checkout', 'Checkout', { timeout: 60000 }).should('exist');
    addChargesOnScreen(['Annual Wellness Visit', 'Trip Fee', 'DAPP (Distemper) Vaccine - 3 year', 'Heartworm / Tick Test (4dx)']);
    // All covered, so the bill is $0: finalize it (a charge would be refused with nothing due).
    cy.then(() => schedulingApi('cl', 'POST', `/visit-invoices/${invoiceId}/finalize`, { practiceId: w.practiceId }, false)).then((r) =>
      expect(r.status, JSON.stringify(r.body)).to.be.oneOf([200, 201]),
    );
    signInAsScheduling('manager', chartUrl(p.maple));
    quietChart();
    cy.contains('.pims-detail__btn-danger', 'Cancel', { timeout: 60000 }).should('be.visible');
    settle(() => cy.get('.pmp-summary'));
    cy.wait(1000);

    trace('clock');
    startClock();
    trace('m14-01'); line('m14-01');
    trace('m14-02'); line('m14-02');
    trace('m14-02b'); line('m14-02b');
    trace('m14-03'); line('m14-03', () => {
      tap(() => cy.contains('.pims-detail__btn-danger', 'Cancel'));
      cy.get('.pmp-cancel-totals', { timeout: 90000 }).should('exist');
      cy.contains('Working out this term').should('not.exist');
      cy.wait(800);
    });
    trace('m14-04'); line('m14-04', () => pointAt(() => cy.get('.pmp-owner-sees'), 5000));
    trace('m14-05'); line('m14-05', () => pointAt(() => cy.get('.pmp-cancel-totals'), 6000));
    trace('m14-06'); line('m14-06', () => pointAt(() => cy.get('.pmp-cancel-lines').first(), 4500));
    trace('m14-07'); line('m14-07');
    trace('m14-08'); line('m14-08', () => typeSlowly(() => cy.get('.pmp-cancel textarea'), 'Moving out of the service area'));
    trace('m14-09'); line('m14-09', () => {
      tap(() => cy.contains('.pmp-cancel button', /Cancel & charge/));
      cy.contains('[role="dialog"], [role="alertdialog"]', 'Cancel ').should('exist');
    });
    trace('m14-10'); line('m14-10', () => pointAt(() => cy.contains('[role="dialog"], [role="alertdialog"]', 'ends now'), 5000));
    trace('m14-11'); line('m14-11', () => tap(() => cy.contains('[role="dialog"] button, [role="alertdialog"] button', /^Cancel (membership|& charge)/)));
    offCamera(() => {
      cy.contains('Cancellation settlement', { timeout: 120000 }).should('exist');
      cy.wait(1500);
    });
    trace('m14-12'); line('m14-12', () => {
      settle(() => cy.contains('Cancellation settlement'));
      pointAt(() => cy.contains('Cancellation settlement').closest('table, div[class*="lines"]'), 6000);
    });
    offCamera(() => {
      signInAsScheduling('manager', chartUrl(p.maple));
      quietChart();
      cy.contains('Maple is not on a membership plan.', { timeout: 60000 }).should('exist');
      settle(() => cy.contains('Maple is not on a membership plan.'));
      cy.wait(1000);
    });
    trace('m14-12b'); line('m14-12b', () => {
      pointAt(() => cy.contains('Maple is not on a membership plan.'), 5000);
    });
    trace('m14-13'); line('m14-13');
    trace('done');
    finish();
  });
});

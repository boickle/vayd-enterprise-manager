/// <reference types="cypress" />
/**
 * Training video, MEM-09: check a member's invoice before checkout (docs/training/scripts/memberships/MEM-09-member-invoice-check.md).
 * TEST stack, demo names only. Maple is on Canine Foundations (monthly, 40 days in). Dr. Lane charted a wellness visit,
 * rabies, the 4Dx test (all covered) and a sick visit (50% off for members). Casey Morgan (client liaison) reviews
 * the bill on the checkout page.
 */
import '../support/e2e';
import { schedulingApi, schedulingWorld, signInAsScheduling } from '../support/schedulingWorld';
import { openVisit, setBillBranch } from './invKit';
import { addChargesOnScreen, enrolPet, fileAgreement, pets, PLAN, resetMembershipWorld, settle, trace } from './memKit';
import { finish, line, loadNarration, pointAt, startClock } from './trainingKit';

describe('Training: MEM-09 member invoice check', () => {
  it('MEM-09', () => {
    const p = pets();
    const w = schedulingWorld();
    loadNarration();
    trace('setup');
    resetMembershipWorld();
    enrolPet(p.maple, PLAN.dogFoundationsMonthly, { startDaysAgo: 40 });
    fileAgreement(p.maple, p.maria, 40);
    let appt = 0;
    openVisit(p.maple, p.maria, 'Wellness visit', 60).then(({ appt: a }) => {
      appt = a;
      schedulingApi('cl', 'POST', '/visit-invoices', { practiceId: w.practiceId, appointmentId: a, clientId: p.maria });
      setBillBranch(p.maria);
    });
    cy.then(() => signInAsScheduling('doctorA', `/schedule/soap/${appt}/${p.maple}?clientId=${p.maria}`));
    cy.contains('.soap-checkout', 'Checkout', { timeout: 60000 }).should('exist');
    addChargesOnScreen(['Annual Wellness Visit', 'Rabies Vaccine - 3 year', 'Heartworm / Tick Test (4dx)', 'Medical/Sick Visit']);
    cy.then(() => signInAsScheduling('cl', `/schedule/soap/${appt}/${p.maple}/checkout?clientId=${p.maria}`));
    cy.contains('.soap-invoice-line', 'Medical/Sick Visit', { timeout: 60000 }).should('exist');
    cy.wait(2000);

    const ln = (name: string) => cy.contains('.soap-invoice-line', name);
    trace('clock');
    startClock();
    trace('m09-01'); line('m09-01');
    trace('m09-02'); line('m09-02');
    trace('m09-03'); line('m09-03', () => {
      settle(() => cy.get('.soap-invoice-lines').first());
      pointAt(() => ln('Annual Wellness Visit').find('svg, [class*="heart"]').first(), 3000);
    });
    trace('m09-04'); line('m09-04', () => pointAt(() => cy.get('.soap-invoice-lines').first(), 7000));
    trace('m09-05'); line('m09-05', () => pointAt(() => ln('Medical/Sick Visit'), 5500));
    trace('m09-06'); line('m09-06');
    trace('m09-07'); line('m09-07', () => pointAt(() => cy.get('.soap-invoice-totals'), 5000));
    trace('m09-08'); line('m09-08', () => {
      settle(() => cy.get('.soap-checkout-reprice'));
      pointAt(() => cy.get('.soap-checkout-reprice'), 5000);
    });
    trace('m09-09'); line('m09-09');
    trace('done');
    finish();
  });
});

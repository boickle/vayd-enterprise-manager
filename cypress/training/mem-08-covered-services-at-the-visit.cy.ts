/// <reference types="cypress" />
/**
 * Training video, MEM-08: covered services during the visit (docs/training/scripts/memberships/MEM-08-covered-services-at-the-visit.md).
 * TEST stack, demo names only. Maple is on Canine Foundations (monthly, 40 days in) and already had her DAPP 3-year
 * vaccine this term. Dr. Avery Lane adds a wellness visit (covered), DAPP (used up: regular price) and a Quick (Tech)
 * Visit (two benefits match: the coverage picker).
 */
import '../support/e2e';
import { schedulingApi, schedulingWorld, signInAsScheduling } from '../support/schedulingWorld';
import { openVisit, setBillBranch } from './invKit';
import { enrolPet, fileAgreement, pets, PLAN, resetMembershipWorld, settle, trace, useBenefits } from './memKit';
import { finish, line, loadNarration, pointAt, startClock, tap, typeSlowly } from './trainingKit';

describe('Training: MEM-08 covered services', () => {
  it('MEM-08', () => {
    const p = pets();
    const w = schedulingWorld();
    loadNarration();
    trace('setup');
    resetMembershipWorld();
    enrolPet(p.maple, PLAN.dogFoundationsMonthly, { startDaysAgo: 40 }).then((id) =>
      useBenefits(id, [{ name: 'DAPP (Distemper) Vaccine - 3 year', daysAgo: 25 }])
    );
    fileAgreement(p.maple, p.maria, 40);
    let appt = 0;
    openVisit(p.maple, p.maria, 'Wellness visit', 60).then(({ appt: a }) => {
      appt = a;
      schedulingApi('cl', 'POST', '/visit-invoices', { practiceId: w.practiceId, appointmentId: a, clientId: p.maria });
      setBillBranch(p.maria);
    });
    cy.then(() => signInAsScheduling('doctorA', `/schedule/soap/${appt}/${p.maple}?clientId=${p.maria}`));
    cy.contains('.soap-checkout', 'Checkout', { timeout: 60000 }).should('exist');
    cy.wait(2000);

    const box = () => cy.get('.soap-checkout input[placeholder^="Type here to add a charge"]');
    const opt = (name: string) => cy.contains('button[role="option"]', name);
    const ln = (name: string) => cy.contains('.soap-invoice-line', name);
    trace('clock');
    startClock();
    trace('m08-01'); line('m08-01', () => settle(() => cy.get('.soap-checkout')));
    trace('m08-02'); line('m08-02');
    trace('m08-03'); line('m08-03', () => tap(box));
    trace('m08-04'); line('m08-04', () => typeSlowly(box, 'Annual Wellness Visit'));
    trace('m08-05'); line('m08-05', () => {
      tap(() => opt('Annual Wellness Visit').first());
      cy.get('.mcp-modal', { timeout: 30000 }).should('exist');
    });
    trace('m08-06'); line('m08-06', () => pointAt(() => cy.get('.mcp-options'), 6000));
    trace('m08-07'); line('m08-07', () => tap(() => cy.contains('.mcp-option', /\$0\.00/).find('input')));
    trace('m08-08'); line('m08-08', () => {
      tap(() => cy.contains('.mcp-btn--primary', 'Use this benefit'));
      ln('Annual Wellness Visit').should('exist');
    });
    trace('m08-09'); line('m08-09', () => pointAt(() => ln('Annual Wellness Visit'), 4000));
    trace('m08-10'); line('m08-10', () => {
      box().clear();
      typeSlowly(box, 'DAPP (Distemper) Vaccine - 3');
    });
    trace('m08-11'); line('m08-11', () => {
      tap(() => opt('DAPP (Distemper) Vaccine - 3 year').first());
      ln('DAPP').should('exist');
    });
    trace('m08-12'); line('m08-12', () => pointAt(() => ln('DAPP'), 6000));
    trace('m08-13'); line('m08-13', () => {
      const t = () => cy.get('.soap-invoice-row.total');
      settle(t);
      pointAt(() => t().parent(), 5000);
    });
    trace('m08-14'); line('m08-14');
    trace('done');
    finish();
  });
});

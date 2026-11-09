/// <reference types="cypress" />
/**
 * Training video, MEM-07: second pet, the $75 credit (docs/training/scripts/memberships/MEM-07-second-pet-credit.md).
 * TEST stack on Stripe TEST mode, demo names only. Maple has been on Canine Foundations for 60 days; Juniper joins
 * Feline Foundations today (online-style enrolment), which posts the $75 multi-pet credit. A counter invoice for a
 * Revolution Plus dose is open. Casey Morgan (client liaison) pays it with the credit.
 */
import '../support/e2e';
import { signInAsScheduling } from '../support/schedulingWorld';
import { counterBill } from './invKit';
import { chartUrl, enrolPet, fileAgreement, pets, PLAN, quietChart, resetMembershipWorld, settle, trace } from './memKit';
import { finish, line, loadNarration, offCamera, pointAt, startClock, tap } from './trainingKit';

describe('Training: MEM-07 second pet credit', () => {
  it('MEM-07', () => {
    const p = pets();
    loadNarration();
    trace('setup');
    resetMembershipWorld();
    enrolPet(p.maple, PLAN.dogFoundationsMonthly, { startDaysAgo: 60 });
    fileAgreement(p.maple, p.maria, 60);
    enrolPet(p.juniper, PLAN.catFoundationsMonthly, { startDaysAgo: 0.02 });
    fileAgreement(p.juniper, p.maria, 0);
    let bill = '';
    counterBill(p.juniper, p.maria, ['Revolution Plus for Cats 5.6-11lb']).then((id) => (bill = String(id)));
    signInAsScheduling('cl', chartUrl(p.juniper));
    quietChart();
    cy.get('.pmp-audit__toggle', { timeout: 60000 }).should('exist');
    cy.wait(1500);

    const fin = () => `/schedule/clients?clientId=${p.maria}&tab=financial`;
    trace('clock');
    startClock();
    trace('m07-01'); line('m07-01');
    trace('m07-02'); line('m07-02');
    trace('m07-03'); line('m07-03', () => {
      pointAt(() => cy.get('.pims-emr-household__pets'), 3000);
      settle(() => cy.get('.pmp-audit__toggle'));
    });
    trace('m07-04'); line('m07-04', () => tap(() => cy.get('.pmp-audit__toggle')));
    trace('m07-05'); line('m07-05', () => pointAt(() => cy.contains('.pmp-audit__entry', 'Multi-Pet'), 5000));
    offCamera(() => {
      cy.visit(fin());
      cy.contains('Ledger', { timeout: 60000 }).should('exist');
      cy.wait(2500);
      cy.window().then((win) => win.scrollTo(0, 0));
    });
    trace('m07-06'); line('m07-06', () => {
      pointAt(() => cy.contains(/^credit$/i).first().parent(), 3000);
      settle(() => cy.contains('tr', '($75.00)'));
    });
    trace('m07-07'); line('m07-07', () => {
      tap(() => cy.contains('tr', '($75.00)'));
      cy.contains('Membership Multi-Pet — Juniper', { timeout: 30000 }).should('exist');
    });
    trace('m07-08'); line('m07-08', () => {
      const ln = () => cy.contains('Membership Multi-Pet — Juniper');
      settle(ln);
      pointAt(ln, 3000);
      settle(() => cy.contains('tr', '$32.02'));
    });
    trace('m07-09'); line('m07-09', () => {
      tap(() => cy.contains('tr', '$32.02'));
      cy.contains('Revolution Plus', { timeout: 30000 }).should('exist');
    });
    trace('m07-10'); line('m07-10', () => {
      const sel = () => cy.get('.client-fin__field--pay-method select');
      settle(sel);
      pointAt(sel, 1500);
      sel().select('account_credit');
    });
    trace('m07-11'); line('m07-11', () => pointAt(() => cy.contains('Account credit:').parent(), 5000));
    trace('m07-12'); line('m07-12', () => tap(() => cy.contains('button', 'Apply credit')));
    offCamera(() => cy.contains('Paid', { timeout: 60000 }).should('exist'));
    trace('m07-13'); line('m07-13', () => pointAt(() => cy.contains(/^credit$/i).first().parent(), 4500));
    trace('m07-14'); line('m07-14');
    trace('done');
    finish();
    void bill;
  });
});

/// <reference types="cypress" />
/**
 * Training video, MEM-19: renewals, the 14-day notice and what the client can choose (docs/training/scripts/memberships/MEM-19-renewals.md).
 * TEST stack on Stripe TEST mode, demo names only. Maple's Canine Foundations (monthly) year ends in 7 days. The page
 * is opened from the link the renewal email carries (signed with the test stack's test-only secret). A paid wellness
 * visit 200 days ago, charged through the screen so the plan covers it, gives the page its "covered $X of care" line.
 */
import '../support/e2e';
import { schedulingApi, schedulingWorld, signInAsScheduling } from '../support/schedulingWorld';
import { giveSavedCard, openVisit, setBillBranch, sql } from './invKit';
import { addChargesOnScreen, enrolPet, fileAgreement, pets, PLAN, renewalLink, resetMembershipWorld, settle, trace } from './memKit';
import { finish, line, loadNarration, offCamera, pointAt, startClock, tap } from './trainingKit';

describe('Training: MEM-19 renewals', () => {
  it('MEM-19', () => {
    const p = pets();
    loadNarration();
    trace('setup');
    resetMembershipWorld();
    const w = schedulingWorld();
    let membershipId = 0;
    enrolPet(p.maple, PLAN.dogFoundationsMonthly, { startDaysAgo: 358 }).then((id) => {
      membershipId = id;
      fileAgreement(p.maple, p.maria, 358);
    });
    giveSavedCard(p.maria, 'maria.rivera@example.com', 'Maria Rivera');
    // Owner, Nov 11: the page says how much care the membership covered this year. A covered visit 200 days ago.
    cy.then(() => sql(`UPDATE appointments SET "isDeleted"=true WHERE "patientId"=${p.maple} AND "appointmentStart" < now() - interval '1 day'`));
    let appt = 0;
    let invoiceId = '';
    openVisit(p.maple, p.maria, 'Wellness visit', 200 * 24 * 60).then(({ appt: a }) => {
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
    cy.then(() => renewalLink(membershipId).then((path) => cy.visit(path)));
    cy.get('.renewal-review__covered', { timeout: 60000 }).should('be.visible');
    cy.contains('h1', "Review Maple's membership", { timeout: 90000 }).should('be.visible');
    cy.wait(1500);

    trace('clock');
    startClock();
    trace('m19-01'); line('m19-01');
    trace('m19-02'); line('m19-02');
    trace('m19-03'); line('m19-03', () => pointAt(() => cy.contains('h1', "Review Maple's membership").parent(), 5000));
    // Owner review, Nov 10-11: say why renewing is worth it, on the page itself.
    trace('m19-04'); line('m19-04', () => {
      settle(() => cy.get('.renewal-review__why'));
      cy.wait(700, { log: false }); // let the smooth scroll finish so the outline lands on the box
      pointAt(() => cy.get('.renewal-review__why'), 9500);
    });
    trace('m19-04b'); line('m19-04b', () => {
      settle(() => cy.get('.renewal-review__card'));
      pointAt(() => cy.get('.renewal-review__card'), 4500);
    });
    trace('m19-05'); line('m19-05', () => {
      tap(() => cy.get('.renewal-review__change-plan'));
      cy.contains('h2', 'Choose a plan for next year').should('exist');
    });
    trace('m19-06'); line('m19-06', () => {
      pointAt(() => cy.contains('h2', 'Choose a plan for next year').next(), 4500);
      settle(() => cy.get('.renewal-review__interval-yearly'));
    });
    trace('m19-07'); line('m19-07', () => {
      tap(() => cy.get('.renewal-review__interval-yearly'));
      settle(() => cy.contains('.renewal-review__primary', 'Save my choice'));
    });
    trace('m19-08'); line('m19-08', () => {
      tap(() => cy.contains('.renewal-review__primary', 'Save my choice'));
    });
    offCamera(() => cy.contains('.renewal-review__stay', 'Saved.', { timeout: 60000 }).should('exist'));
    trace('m19-09'); line('m19-09', () => {
      settle(() => cy.contains('.renewal-review__stay', 'Saved.'));
      pointAt(() => cy.contains('.renewal-review__stay', 'Saved.'), 4000);
      settle(() => cy.get('.renewal-review__cancel-link'));
    });
    trace('m19-10'); line('m19-10', () => {
      tap(() => cy.get('.renewal-review__cancel-link'));
      cy.get('form.renewal-review__cancel').should('exist');
    });
    trace('m19-11'); line('m19-11', () => {
      settle(() => cy.get('form.renewal-review__cancel'));
      pointAt(() => cy.get('form.renewal-review__cancel'), 8000);
    });
    trace('m19-12'); line('m19-12');
    trace('done');
    finish();
  });
});

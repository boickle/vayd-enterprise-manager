/// <reference types="cypress" />
import '../../support/e2e';
import { schedulingApi, schedulingWorld, signInAsScheduling } from '../../support/schedulingWorld';
import { giveSavedCard, openVisit, setBillBranch } from '../invKit';
import { addChargesOnScreen, chartUrl, enrolPet, fileAgreement, pets, PLAN, quietChart, resetMembershipWorld, sql } from '../memKit';

describe('probe p14b', () => {
  it('cancel after a real covered visit', () => {
    const p = pets();
    const w = schedulingWorld();
    resetMembershipWorld();
    enrolPet(p.maple, PLAN.dogFoundationsMonthly, { startDaysAgo: 60 });
    fileAgreement(p.maple, p.maria, 60);
    giveSavedCard(p.maria, 'maria.rivera@example.com', 'Maria Rivera');
    let appt = 0; let inv = '';
    openVisit(p.maple, p.maria, 'Wellness visit', 120).then(({ appt: a }) => {
      appt = a;
      schedulingApi<{ id: string }>('cl', 'POST', '/visit-invoices', { practiceId: w.practiceId, appointmentId: a, clientId: p.maria }).then((r) => (inv = r.body.id));
      setBillBranch(p.maria);
    });
    cy.then(() => signInAsScheduling('doctorA', `/schedule/soap/${appt}/${p.maple}?clientId=${p.maria}`));
    cy.contains('.soap-checkout', 'Checkout', { timeout: 60000 }).should('exist');
    addChargesOnScreen(['Annual Wellness Visit', 'Rabies Vaccine - 3 year', 'Heartworm / Tick Test (4dx)', 'Medical/Sick Visit']);
    cy.then(() => schedulingApi('cl', 'POST', `/visit-payments/${inv}/charge-saved-card`, { practiceId: w.practiceId }));
    cy.then(() => sql(`SELECT status || ' total=' || total || ' paid=' || "amountPaid" || ' adj=' || "membershipAdjustments" FROM visit_invoices WHERE id='${inv}'`).then((s) => cy.writeFile(Cypress.env('PROBE_OUT') + '/inv.txt', String(s))));
    signInAsScheduling('manager', chartUrl(p.maple));
    quietChart();
    cy.contains('.pims-detail__btn-danger', 'Cancel', { timeout: 60000 }).click();
    cy.get('.pmp-cancel', { timeout: 60000 }).should('exist');
    cy.wait(6000);
    cy.get('.pmp-cancel').then(($c) => cy.writeFile(Cypress.env('PROBE_OUT') + '/cancel.txt', $c[0].innerText));
  });
});

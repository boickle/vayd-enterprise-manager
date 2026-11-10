/// <reference types="cypress" />
/**
 * Training video, MEM-02: enroll a pet at the visit (docs/training/scripts/memberships/MEM-02-enroll-at-the-visit.md).
 * TEST stack, demo names only. Juniper (cat, 6 y) has no plan and a wellness visit in progress (open invoice).
 * Maria signs on screen; Casey Morgan (client liaison) enrols Juniper on Feline Foundations monthly. The $59 fee
 * goes on the visit invoice (owner decision, Nov 10, 2026), Maria's card on file is saved for later months, and
 * one charge at checkout pays the visit and the first month (Stripe test mode, test Visa).
 */
import '../support/e2e';
import { signInAsScheduling } from '../support/schedulingWorld';
import { schedulingApi, schedulingWorld } from '../support/schedulingWorld';
import { catalogId, giveSavedCard, openVisit, setBillBranch, sql } from './invKit';
import { chartUrl, drawSignature, pets, quietChart, resetMembershipWorld, settle, trace } from './memKit';
import { finish, line, loadNarration, offCamera, pointAt, startClock, tap, typeSlowly } from './trainingKit';

describe('Training: MEM-02 enroll at the visit', () => {
  it('MEM-02', () => {
    const p = pets();
    loadNarration();
    trace('setup');
    const w = schedulingWorld();
    resetMembershipWorld();
    giveSavedCard(p.maria, 'maria.rivera@example.com', 'Maria Rivera');
    // Juniper's wellness visit is in progress: charges on an open invoice, not paid yet.
    let appt = 0;
    openVisit(p.juniper, p.maria, 'Wellness visit', 40).then(({ appt: a, enc }) => {
      appt = a;
      schedulingApi('cl', 'POST', '/visit-invoices', { practiceId: w.practiceId, appointmentId: a, clientId: p.maria });
      setBillBranch(p.maria);
      ['Annual Wellness Visit', 'Trip Fee', 'FVRCP (Distemper) Vaccine - 3 year', 'Revolution Plus for Cats 5.6-11lb'].forEach((item) =>
        catalogId(item).then((c) =>
          sql(`SELECT price FROM ${c.type === 'procedure' ? 'procedures' : 'inventory_items'} WHERE id=${c.id}`).then((price) =>
            schedulingApi('doctorA', 'POST', `/soap-encounters/${enc}/orders`, {
              practiceId: w.practiceId, name: item, catalogItemId: c.id, catalogItemType: c.type, qty: 1, kind: 'treatment', state: 'accepted', unitPrice: Number(price),
            })
          )
        )
      );
    });
    trace('reset done');
    signInAsScheduling('cl', chartUrl(p.juniper));
    quietChart();
    cy.contains('button', 'Enroll in a plan', { timeout: 60000 }).should('be.visible');
    cy.wait(1500);

    const planRow = () => cy.contains('.pmp-plan', 'Membership - Feline Foundations - Monthly');
    trace('clock');
    startClock();
    trace('m02-01');
    line('m02-01');
    trace('m02-02');
    line('m02-02');
    trace('m02-03');
    line('m02-03', () => {
      tap(() => cy.contains('button', 'Enroll in a plan'));
      cy.get('.membership-waiver').should('exist');
    });
    trace('m02-04');
    line('m02-04', () => pointAt(() => cy.get('.membership-waiver h3'), 3500));
    trace('m02-05');
    line('m02-05', () => {
      pointAt(() => cy.get('.membership-waiver__scroll'), 2500);
      cy.get('.membership-waiver__scroll').scrollTo('center', { duration: 2500 });
    });
    trace('m02-06');
    line('m02-06', () => tap(() => cy.get('.membership-waiver__check input')));
    trace('m02-07');
    line('m02-07', () => drawSignature(() => cy.get('.membership-waiver__draw canvas')));
    trace('m02-08');
    line('m02-08', () => typeSlowly(() => cy.get('.membership-waiver__sign input'), 'Maria Rivera'));
    trace('m02-09'); line('m02-09', () => pointAt(() => cy.contains('.pmp-muted', 'Enrolling prices this visit'), 4500));
    trace('m02-10'); line('m02-10', () => {
      settle(() => cy.get('.pmp-enrol-card'));
      pointAt(() => cy.get('.pmp-enrol-card'), 4000);
      settle(planRow);
    });
    trace('m02-12'); line('m02-12', () => pointAt(planRow, 5000));
    trace('m02-13'); line('m02-13', () => tap(() => planRow().find('button')));
    trace('m02-14'); line('m02-14', () => pointAt(() => cy.contains('[role="dialog"], [role="alertdialog"]', 'Enroll in Membership - Feline Foundations - Monthly?'), 6000));
    trace('m02-15'); line('m02-15', () => tap(() => cy.contains('[role="dialog"] button, [role="alertdialog"] button', /^Enroll & add/)));
    offCamera(() => {
      cy.get('.pmp-awaiting', { timeout: 120000 }).should('exist');
      settle(() => cy.get('.pmp-awaiting'));
      cy.wait(800);
    });
    trace('m02-16'); line('m02-16', () => pointAt(() => cy.get('.pmp-awaiting'), 6000));
    offCamera(() => {
      cy.then(() => signInAsScheduling('cl', `/schedule/soap/${appt}/${p.juniper}/checkout?clientId=${p.maria}`));
      cy.contains('.soap-invoice-line', 'Membership - Feline Foundations - Monthly', { timeout: 60000 }).should('exist');
      settle(() => cy.get('.soap-invoice-lines').first());
      cy.wait(1500);
    });
    trace('m02-17'); line('m02-17', () => {
      pointAt(() => cy.get('.soap-invoice-lines').first(), 4500);
      pointAt(() => cy.contains('.soap-invoice-line', 'Membership - Feline Foundations - Monthly'), 2500);
      settle(() => cy.get('[data-testid="card-on-file-button"]'));
    });
    trace('m02-18'); line('m02-18', () => tap(() => cy.get('[data-testid="card-on-file-button"]')));
    trace('m02-19'); line('m02-19', () => {
      tap(() => cy.get('[data-testid="card-on-file-confirm"] button.primary'));
      cy.contains('Charged the card on file.', { timeout: 60000 }).should('exist');
    });
    offCamera(() => {
      cy.then(() => signInAsScheduling('cl', chartUrl(p.juniper)));
      quietChart();
      cy.get('.pmp-summary', { timeout: 60000 }).should('exist');
      cy.get('.pmp-awaiting').should('not.exist');
      settle(() => cy.get('.pmp-summary'));
      cy.wait(1000);
    });
    trace('m02-20'); line('m02-20', () => pointAt(() => cy.get('.pmp-summary'), 5000));
    trace('m02-21'); line('m02-21');
    trace('done');
    finish();
  });
});

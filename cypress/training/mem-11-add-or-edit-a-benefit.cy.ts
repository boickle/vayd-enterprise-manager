/// <reference types="cypress" />
/**
 * Training video, MEM-11: add or edit a benefit for one pet (docs/training/scripts/memberships/MEM-11-add-or-edit-a-benefit.md).
 * TEST stack, demo names only. Maple on Canine Foundations monthly, 40 days in. Robin Hale (practice manager) adds an
 * ear cytology for Maple only, as goodwill, then opens Benefit details & edits to show Edit.
 */
import '../support/e2e';
import { signInAsScheduling } from '../support/schedulingWorld';
import { chartUrl, enrolPet, fileAgreement, pets, PLAN, quietChart, resetMembershipWorld, settle, trace } from './memKit';
import { choose, finish, line, loadNarration, offCamera, pointAt, startClock, tap, typeSlowly } from './trainingKit';

describe('Training: MEM-11 add or edit a benefit', () => {
  it('MEM-11', () => {
    const p = pets();
    loadNarration();
    trace('setup');
    resetMembershipWorld();
    enrolPet(p.maple, PLAN.dogFoundationsMonthly, { startDaysAgo: 40 });
    fileAgreement(p.maple, p.maria, 40);
    signInAsScheduling('manager', chartUrl(p.maple));
    quietChart();
    cy.contains('button', 'Add benefit', { timeout: 60000 }).should('not.be.disabled');
    settle(() => cy.get('.pmp-summary'));
    cy.wait(1000);

    const form = () => cy.contains('.pmp-form__actions', 'Add benefit').parent();
    trace('clock');
    startClock();
    trace('m11-01'); line('m11-01');
    trace('m11-02'); line('m11-02');
    trace('m11-02b'); line('m11-02b');
    trace('m11-03'); line('m11-03', () => {
      tap(() => cy.contains('button', 'Add benefit'));
      cy.contains('Add a benefit to this pet only').should('exist');
    });
    trace('m11-04'); line('m11-04', () => {
      const lede = () => cy.contains('p', 'the plan').filter(':contains("template is untouched")');
      settle(lede);
      pointAt(lede, 4000);
    });
    trace('m11-05'); line('m11-05', () => {
      typeSlowly(() => form().find('.cat-item-picker__input'), 'Ear cytology');
      cy.contains('.cat-item-picker__result', 'Ear cytology', { timeout: 30000 }).should('be.visible');
    });
    trace('m11-05b'); line('m11-05b', () => tap(() => cy.contains('.cat-item-picker__result', 'Ear cytology').first()));
    trace('m11-06'); line('m11-06', () => {
      const allowance = () => form().contains('.pmp-field', 'Allowance');
      pointAt(allowance, 3000);
      settle(() => form().contains('.pmp-field', 'Coverage').find('select'));
    });
    trace('m11-07'); line('m11-07', () => {
      const cov = () => form().contains('.pmp-field', 'Coverage').find('select');
      choose(cov, 'included');
    });
    trace('m11-08'); line('m11-08', () => typeSlowly(() => form().find('input[placeholder="Why this pet gets this benefit"]'), 'Goodwill: ear recheck after a missed visit'));
    trace('m11-09'); line('m11-09', () => {
      tap(() => form().contains('.pims-detail__btn-primary', 'Add benefit'));
      cy.contains('Add a benefit to this pet only').should('not.exist');
      cy.wait(1000);
    });
    trace('m11-10'); line('m11-10', () => {
      const row = () => cy.get('.pmp-allowance').contains('Ear cytology');
      settle(row);
      pointAt(row, 3000);
      pointAt(() => cy.get('.pmp-summary').contains('added for this pet'), 2000);
      settle(() => cy.get('.pmp-inactive-details-toggle').filter(':contains("Benefit details")'));
    });
    trace('m11-11'); line('m11-11', () => {
      const toggle = () => cy.get('.pmp-inactive-details-toggle').filter(':contains("Benefit details")');
      tap(toggle);
      cy.get('.pmp-groups', { timeout: 30000 }).should('exist');
      settle(() => cy.get('.pmp-groups .pmp-benefit__actions').first().contains('button', 'Edit'));
    });
    trace('m11-12'); line('m11-12', () => {
      const edit = () => cy.get('.pmp-groups .pmp-benefit__actions').first().contains('button', 'Edit');
      tap(edit);
      cy.get('.pmp-form__title', { timeout: 30000 }).should('exist');
    });
    trace('m11-13'); line('m11-13', () => {
      settle(() => cy.get('.pmp-form__title').parent());
      pointAt(() => cy.get('.pmp-form__title').parent(), 4500);
    });
    trace('m11-14'); line('m11-14');
    trace('done');
    finish();
  });
});

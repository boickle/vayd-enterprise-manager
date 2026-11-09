/// <reference types="cypress" />
/**
 * Training video LV-13: set up a lab form (docs/training/scripts/labs/LV-13-set-up-a-lab-form.md). TEST stack;
 * Settings needs an admin login: CYPRESS_ADMIN_TOKEN is a test-only admin token for Robin Hale (the world's
 * manager), minted for this stack. Catalog lab "Fecal float" and the archived form come from setup/labs-demo.sql.
 */
import '../support/e2e';
import { finish, line, loadNarration, pointAt, startClock, tap, typeSlowly, choose } from './trainingKit';
import { labsDb, labsSetup } from './labsTraining';

describe('Training: LV-13 lab forms', () => {
  it('LV-13', () => {
    loadNarration();
    labsSetup([0]);
    cy.exec(`psql -q -d ${labsDb()} -c "UPDATE lab_form_templates SET \\"isDeleted\\"=true WHERE name='Fecal float' AND \\"isDeleted\\"=false"`);
    const token = String(Cypress.env('ADMIN_TOKEN') || '');
    expect(token, 'CYPRESS_ADMIN_TOKEN').to.have.length.greaterThan(20);
    cy.visit('/login');
    cy.window().then((win) => {
      win.localStorage.clear();
      win.localStorage.setItem('accessToken', token);
    });
    cy.visit('/schedule/settings?tab=lab-forms');
    cy.contains('In-house lab forms', { timeout: 120000 }).should('exist');
    cy.wait(2000);
    const tab = (name: RegExp) => cy.contains('[role="tab"]', name);

    startClock();
    line('lv13-01');
    line('lv13-02');
    line('lv13-03', () => {
      pointAt(() => tab(/^Active/), 1800);
      pointAt(() => tab(/^Archived/), 1800);
    });
    line('lv13-04', () => {
      tap(() => cy.contains('button', 'New lab form'));
      cy.get('input[placeholder="HEARTWORM 4DX PLUS"]').should('exist');
    });
    line('lv13-05', () => typeSlowly(() => cy.get('input[placeholder="HEARTWORM 4DX PLUS"]'), 'Fecal float'));
    line('lv13-06', () => pointAt(() => cy.contains('label', 'Result style').find('select'), 3000));
    line('lv13-07', () => typeSlowly(() => cy.get('input[aria-label="Row 1 name"]'), 'Parasite ova'));
    line('lv13-08', () => choose(() => cy.get('select[aria-label="Row 1 type"]'), 'select'));
    line('lv13-09', () => typeSlowly(() => cy.get('input[placeholder="Choices, comma separated"]').first(), 'Negative, Positive'));
    line('lv13-10', () => typeSlowly(() => cy.get('input[placeholder="Which choices are abnormal"]').first(), 'Positive'));
    line('lv13-11', () => typeSlowly(() => cy.get('input[placeholder="Search labs and procedures to attach…"]'), 'Fecal'));
    line('lv13-12', () => tap(() => cy.contains('li button', 'Fecal float', { timeout: 20000 })));
    line('lv13-13', () => {
      tap(() => cy.contains('button', 'Save lab form'));
      cy.contains(/Saved Fecal float/, { timeout: 30000 }).should('exist');
    });
    line('lv13-14', () => pointAt(() => cy.contains('button', 'Archive').first(), 3000));
    line('lv13-14b', () => {
      tap(() => tab(/^Archived/));
      cy.contains('Glucose curve (old)', { timeout: 30000 }).should('exist');
    });
    line('lv13-14c', () => {
      tap(() => cy.contains('button, li, a', 'Glucose curve (old)').first());
      cy.contains('button', 'Restore', { timeout: 30000 }).should('exist');
      pointAt(() => cy.contains('button', 'Restore').first(), 2000);
    });
    line('lv13-15');
    line('lv13-16');
    finish();
  });
});

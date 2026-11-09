/// <reference types="cypress" />
/**
 * Training video LV-09: unmatched IDEXX results (docs/training/scripts/labs/LV-09-unmatched-results.md).
 * TEST stack; setup/labs-unmatched.sql copies a sandbox result as one IDEXX sent for "Biscuit (Chen-Lee)" with
 * no Scout order. Demo names: Tom Chen's dog Biscuit, Jordan Pike (tech).
 */
import '../support/e2e';
import { schedulingWorld, signInAsScheduling } from '../support/schedulingWorld';
import { finish, line, loadNarration, pointAt, startClock, tap, typeSlowly } from './trainingKit';
import { freshResults, labsDb, labsSetup } from './labsTraining';

describe('Training: LV-09 unmatched results', () => {
  it('LV-09', () => {
    const w = schedulingWorld();
    const biscuit = w.households.B.petId;
    loadNarration();
    labsSetup([biscuit]);
    freshResults([0]);
    cy.exec(`psql -q -d ${labsDb()} -f cypress/training/setup/labs-unmatched.sql`);
    signInAsScheduling('technician', '/schedule/idexx-results');
    const tab = (name: string) => cy.contains('[role="tab"]', name, { timeout: 120000 });
    tab('Unmatched').find('.pending-labs__count').should('exist');
    cy.wait(2000);
    const row = () => cy.get('button[aria-label="Expand Biscuit"], button[aria-label="Collapse Biscuit"]').first();
    const search = () => cy.get('input[placeholder="Pet or owner name"]');

    startClock();
    line('lv09-01');
    line('lv09-02');
    line('lv09-03', () => pointAt(() => tab('Unmatched').find('.pending-labs__count'), 2500));
    line('lv09-03b', () => {
      tap(() => tab('Unmatched'));
      row().should('exist');
    });
    line('lv09-04', () => pointAt(() => cy.contains('.idexx-result-list__row', 'Chen-Lee'), 3500));
    line('lv09-05', () => {
      tap(row);
      cy.contains('Which pet is this?').should('exist');
    });
    line('lv09-06', () => pointAt(() => cy.contains('IDEXX sent it as'), 3500));
    line('lv09-07', () => {
      search().clear();
      typeSlowly(search, 'Biscuit Chen');
    });
    line('lv09-08', () => {
      tap(() => cy.contains('button', 'Search'));
      cy.contains('button', /Biscuit \(Tom Chen\)/, { timeout: 30000 }).should('exist');
    });
    line('lv09-09', () => pointAt(() => cy.contains('button', /Biscuit \(Tom Chen\)/), 2500));
    line('lv09-09b', () => {
      tap(() => cy.contains('button', /Biscuit \(Tom Chen\)/));
      cy.contains('.idexx-result-list__row', 'Chen-Lee').should('not.exist');
    });
    line('lv09-10', () => {
      tap(() => tab('To review'));
      cy.get('button[aria-label="Expand Biscuit"]', { timeout: 30000 }).should('exist');
      pointAt(() => cy.get('button[aria-label="Expand Biscuit"]').first().closest('.idexx-result-list__row'), 2500);
    });
    line('lv09-11');
    line('lv09-12');
    finish();
  });
});

/// <reference types="cypress" />
/**
 * Training video LV-06: review an IDEXX result (docs/training/scripts/labs/LV-06-review-an-idexx-result.md).
 * TEST stack; Juniper's CBC result came from IDEXX's sandbox before the video (prep order). Demo names: Maria
 * Rivera's cat Juniper, Dr. Avery Lane (doctor).
 */
import '../support/e2e';
import { schedulingWorld, signInAsScheduling } from '../support/schedulingWorld';
import { finish, line, loadNarration, pointAt, startClock, tap } from './trainingKit';
import { freshResults, labsSetup, newestCompleteResult } from './labsTraining';

describe('Training: LV-06 review an IDEXX result', () => {
  it('LV-06', () => {
    const w = schedulingWorld();
    const juniper = w.households.A.activePetIds[1];
    loadNarration();
    labsSetup([juniper]);
    newestCompleteResult(juniper).then((id) => freshResults([id]));
    signInAsScheduling('doctorA', '/schedule/tasks');
    const task = () => cy.contains('a, button, span', /Review IDEXX results: Juniper/, { timeout: 90000 }).first();
    task().should('exist');
    cy.wait(2000);
    const tab = (name: string) => cy.contains('[role="tab"]', name);
    const row = () => cy.get('button[aria-label="Expand Juniper"], button[aria-label="Collapse Juniper"]').first();

    // Under All recent, open the result just reviewed (the Final one), not a newer partial.
    const reviewedRow = () =>
      cy.contains('.idexx-result-list__row', /Final ·/).filter(':contains("Juniper")').first().find('button[aria-label="Expand Juniper"]');

    startClock();
    line('lv06-01');
    line('lv06-02');
    line('lv06-03', () => pointAt(task, 3500));
    line('lv06-04', () => {
      tap(() => cy.contains('nav a, header a', /^Labs$/));
      tab('To review').should('exist');
    });
    line('lv06-05', () => pointAt(() => tab('To review'), 3000));
    line('lv06-06', () => pointAt(() => cy.contains('.idexx-chip', /Final ·/).first(), 3000));
    line('lv06-07', () => {
      tap(row);
      cy.contains('button', 'Mark reviewed', { timeout: 30000 }).should('exist');
    });
    line('lv06-08', () => pointAt(() => cy.contains(/out of range/).first(), 3500));
    line('lv06-09', () => tap(() => cy.contains('button, label', 'Only out of range').first()));
    line('lv06-10', () => pointAt(() => cy.contains('button', 'VetConnect PLUS'), 3000));
    line('lv06-11', () => pointAt(() => cy.contains('button', 'Medical note'), 3000));
    line('lv06-12', () => {
      tap(() => cy.contains('button', 'Mark reviewed'));
      cy.contains('No complete results are waiting for review.', { timeout: 30000 }).should('exist');
    });
    line('lv06-13', () => {
      tap(() => tab('All recent'));
      reviewedRow().should('exist');
    });
    line('lv06-13b', () => {
      tap(reviewedRow);
      cy.get('[data-testid="idexx-reviewed-by"]', { timeout: 30000 }).should('exist');
      pointAt(() => cy.get('[data-testid="idexx-reviewed-by"]'), 2500);
    });
    line('lv06-14');
    line('lv06-15');
    finish();
  });
});

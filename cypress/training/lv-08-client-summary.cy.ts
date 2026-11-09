/// <reference types="cypress" />
/**
 * Training video LV-08: client summary and emailing results (docs/training/scripts/labs/LV-08-client-summary-and-email.md).
 * TEST stack; Juniper's CBC came from IDEXX's sandbox before the video and is reviewed in the setup. The draft is
 * written by the AI with demo data only (owner, Nov 8, 2026). Nothing is sent. Demo names: Maria Rivera's cat
 * Juniper, Dr. Avery Lane.
 */
import '../support/e2e';
import { schedulingWorld, signInAsScheduling } from '../support/schedulingWorld';
import { finish, line, loadNarration, offCamera, pointAt, startClock, tap, typeSlowly } from './trainingKit';
import { freshResults, labsApi, labsSetup, newestCompleteResult } from './labsTraining';

describe('Training: LV-08 client summary', () => {
  it('LV-08', () => {
    const w = schedulingWorld();
    const juniper = w.households.A.activePetIds[1];
    loadNarration();
    labsSetup([juniper]);
    newestCompleteResult(juniper).then((id) => {
      freshResults([id]);
      labsApi('doctorA', 'PATCH', `/idexx/results/${id}/reviewed`, { reviewed: true });
    });
    signInAsScheduling('doctorA', '/schedule/idexx-results');
    cy.contains('[role="tab"]', 'All recent', { timeout: 120000 }).click();
    const row = () => cy.get('button[aria-label="Expand Juniper"], button[aria-label="Collapse Juniper"]', { timeout: 60000 }).first();
    row().should('exist');
    cy.wait(2000);
    const summary = () => cy.get('.idexx-client-summary').first();

    startClock();
    line('lv08-01');
    line('lv08-02');
    line('lv08-03', () => {
      tap(row);
      cy.get('[data-testid="idexx-email-why"]', { timeout: 30000 }).should('exist');
    });
    line('lv08-04', () => pointAt(() => cy.get('[data-testid="idexx-email-why"]'), 3500));
    line('lv08-05', () => tap(() => cy.contains('button', 'Draft client summary')));
    // The AI draft takes a while; the wait is cut from the video.
    offCamera(() => {
      cy.contains('Draft, not approved', { timeout: 180000 }).should('exist');
      cy.wait(1000);
    });
    line('lv08-06', () => {
      pointAt(() => cy.contains('Draft, not approved'), 1800);
      pointAt(() => summary().contains(/^Dear /), 2200);
    });
    line('lv08-07', () => {
      tap(() => summary().contains('button', 'Edit'));
      summary().find('textarea').should('exist');
    });
    line('lv08-08', () => {
      pointAt(() => cy.get('[data-testid="idexx-summary-placeholder"]'), 1800);
      pointAt(() => summary().contains('button', 'Approve wording'), 1800);
    });
    line('lv08-09', () => {
      summary()
        .find('textarea')
        .then(($t) => {
          // Put the cursor right after the placeholder so the doctor's words replace it on camera.
          const el = $t[0] as HTMLTextAreaElement;
          const at = el.value.lastIndexOf(']');
          el.focus();
          el.setSelectionRange(at + 1, at + 1);
        });
      typeSlowly(() => summary().find('textarea'), '{backspace}'.repeat(15) + 'Recheck her glucose and urine in two weeks.');
    });
    line('lv08-10', () => {
      tap(() => summary().contains('button', 'Approve wording'));
      cy.contains(/Approved .* by/, { timeout: 30000 }).should('exist');
    });
    line('lv08-11', () => pointAt(() => cy.contains(/Approved .* by/), 3000));
    line('lv08-12', () => {
      tap(() => cy.contains('button', 'Email lab results'));
      cy.contains('Put on these patient charts', { timeout: 30000 }).should('exist');
    });
    line('lv08-13', () => {
      pointAt(() => cy.contains('label, span, div', /^To$/).first(), 1600);
      pointAt(() => cy.contains('label, span, div', /^Subject$/).first(), 1600);
    });
    offCamera(() => {
      cy.get('[aria-labelledby="client-email-compose-title"]').contains('button', 'Cancel').click();
      cy.contains('Put on these patient charts').should('not.exist');
    });
    line('lv08-14', () => pointAt(() => cy.contains('button', 'Email lab report'), 3000));
    line('lv08-15');
    line('lv08-16');
    finish();
  });
});

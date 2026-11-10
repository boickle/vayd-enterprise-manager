/// <reference types="cypress" />
/**
 * Training video LV-08: client summary and emailing results (docs/training/scripts/labs/LV-08-client-summary-and-email.md).
 * TEST stack; Juniper's CBC came from IDEXX's sandbox before the video. The draft is
 * written by the AI with demo data only (owner, Nov 8, 2026). Nothing is sent. Demo names: Maria Rivera's cat
 * Juniper, Dr. Avery Lane.
 */
import '../support/e2e';
import { schedulingWorld, signInAsScheduling } from '../support/schedulingWorld';
import { finish, line, loadNarration, offCamera, pointAt, startClock, tap, typeSlowly } from './trainingKit';
import { freshResults, labsSetup, newestCompleteResult } from './labsTraining';

describe('Training: LV-08 client summary', () => {
  it('LV-08', () => {
    const w = schedulingWorld();
    const juniper = w.households.A.activePetIds[1];
    loadNarration();
    labsSetup([juniper]);
    // Only this result is under To review (others are marked reviewed), so its row is the one opened.
    newestCompleteResult(juniper).then((id) => freshResults([id]));
    signInAsScheduling('doctorA', '/schedule/idexx-results');
    const row = () => cy.get('button[aria-label="Expand Juniper"], button[aria-label="Collapse Juniper"]', { timeout: 60000 }).first();
    row().should('exist');
    cy.wait(2000);
    const summary = () => cy.get('.idexx-client-summary').first();
    const editor = () => cy.get('[data-testid="idexx-summary-editor"] [contenteditable="true"]').first();

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
      editor().should('exist');
    });
    line('lv08-08', () => {
      pointAt(() => cy.get('[data-testid="idexx-summary-placeholder"]'), 1800);
      pointAt(() => summary().contains('button', 'Approve wording'), 1800);
    });
    line('lv08-09', () => {
      // Select "[doctor to add]" in the editor so the doctor's words replace it on camera.
      editor().then(($ed) => {
        const el = $ed[0];
        const doc = el.ownerDocument;
        const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let node: Node | null = walker.nextNode();
        while (node && !(node.textContent ?? '').includes('[doctor to add]')) node = walker.nextNode();
        expect(node, 'the [doctor to add] placeholder').to.exist;
        const at = (node!.textContent ?? '').indexOf('[doctor to add]');
        el.focus();
        const range = doc.createRange();
        range.setStart(node!, at);
        range.setEnd(node!, at + '[doctor to add]'.length);
        const sel = doc.getSelection()!;
        sel.removeAllRanges();
        sel.addRange(range);
      });
      cy.wait(500);
      editor().type('Recheck her glucose and urine in two weeks.', { delay: 45 });
    });
    line('lv08-10', () => {
      tap(() => summary().contains('button', 'Approve wording'));
      cy.contains(/Approved .* by/, { timeout: 30000 }).should('exist');
    });
    line('lv08-11', () => pointAt(() => cy.contains(/Approved .* by/), 3000));
    line('lv08-12', () => {
      tap(() => cy.get('[data-testid="idexx-summary-email"]'));
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
    line('lv08-14b', () => {
      tap(() => cy.contains('button', 'Medical note'));
      cy.get('.pims-chart-compose__textarea', { timeout: 30000 }).should('be.visible');
      typeSlowly(() => cy.get('.pims-chart-compose__textarea'), '{moveToEnd}{enter}Plan: recheck glucose and urine in two weeks.');
    });
    line('lv08-14c', () => {
      tap(() => cy.get('[aria-labelledby="pims-chart-note-title"]').contains('button', 'Wrap up'));
      cy.contains('Medical note saved on the chart.', { timeout: 30000 }).should('exist');
      cy.get('[aria-labelledby="pims-chart-note-title"]').should('not.exist');
      pointAt(() => cy.contains('Medical note saved on the chart.'), 2500);
    });
    line('lv08-15');
    line('lv08-16');
    finish();
  });
});

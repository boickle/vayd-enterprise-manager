/// <reference types="cypress" />
/**
 * Training video LV-07: a tech marks a result reviewed, with a reason (docs/training/scripts/labs/LV-07-tech-releases-a-result.md).
 * TEST stack; Biscuit's CBC result came from IDEXX's sandbox before the video. Demo names: Tom Chen's dog Biscuit,
 * Dr. Avery Lane, Jordan Pike (tech).
 */
import '../support/e2e';
import { schedulingWorld, signInAsScheduling } from '../support/schedulingWorld';
import { finish, line, loadNarration, offCamera, pointAt, startClock, tap } from './trainingKit';
import { freshResults, labsSetup, newestCompleteResult } from './labsTraining';

describe('Training: LV-07 tech marks a result reviewed', () => {
  it('LV-07', () => {
    const w = schedulingWorld();
    const biscuit = w.households.B.petId;
    loadNarration();
    labsSetup([biscuit]);
    newestCompleteResult(biscuit).then((id) => freshResults([id]));
    signInAsScheduling('technician', '/schedule/idexx-results');
    const row = () => cy.get('button[aria-label="Expand Biscuit"], button[aria-label="Collapse Biscuit"]', { timeout: 90000 }).first();
    row().should('exist');
    cy.wait(2000);
    const prompt = () => cy.get('[data-testid="idexx-reason-prompt"]');

    startClock();
    line('lv07-01');
    line('lv07-02');
    line('lv07-03', () => {
      tap(row);
      cy.contains('button', 'Mark reviewed', { timeout: 30000 }).should('exist');
    });
    line('lv07-04', () => {
      tap(() => cy.contains('button', 'Mark reviewed'));
      prompt().should('be.visible');
    });
    line('lv07-05', () => pointAt(() => prompt().find('.perm-reason-note'), 3000));
    line('lv07-06', () => tap(() => prompt().contains('label', 'Vet reviewed verbally')));
    line('lv07-07', () => {
      pointAt(() => prompt().contains('label', 'Vet asked me to send it to the client'), 1800);
      pointAt(() => prompt().contains('label', 'Other'), 1800);
    });
    line('lv07-08', () => {
      tap(() => prompt().contains('button', 'Mark reviewed'));
      prompt().should('not.exist');
    });
    line('lv07-09', () => {
      tap(() => cy.contains('[role="tab"]', 'All recent'));
      row().should('exist');
    });
    line('lv07-09b', () => {
      tap(row);
      cy.get('[data-testid="idexx-reviewed-by"]', { timeout: 30000 }).should('contain.text', 'Vet reviewed verbally');
      pointAt(() => cy.get('[data-testid="idexx-reviewed-by"]'), 2500);
    });
    offCamera(() => {
      cy.visit(`/schedule/patients?patientId=${biscuit}`);
      cy.contains('[role="tab"]', /^History$/, { timeout: 120000 }).click();
      cy.contains('tr', 'Vet reviewed verbally', { timeout: 30000 }).should('exist');
    });
    line('lv07-10', () => pointAt(() => cy.contains('tr', 'Vet reviewed verbally').first(), 3500));
    line('lv07-11');
    finish();
  });
});

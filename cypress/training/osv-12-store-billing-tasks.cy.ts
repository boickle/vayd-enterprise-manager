/// <reference types="cypress" />
/**
 * Training video OSV-12: store Billing tasks. TEST stack, Stripe TEST mode.
 * Setup: online-store-billing-tasks.cjs posts signed TEST Stripe events (to the training API only): Tom Chen's joint chews
 * auto-ship for Biscuit fails for good and Stripe ends it, so Scout ends it and opens a Billing task. Morgan Ellis (Billing / AR) works it.
 * Rows 4 to 6 of the script (refunded charge, not set up, cancel pending) aren't set up yet: see review-pass1.md.
 */
import '../support/e2e';
import { look, press, resetStoreData, signIn, sql } from './osvTraining';
import { finish, line, loadNarration, offCamera, startClock, tap } from './trainingKit';

describe('Training: OSV-12 store billing tasks', () => {
  it('OSV-12', () => {
    const TITLE = /^Call Tom Chen: auto-ship card failed/;
    loadNarration();
    resetStoreData();
    sql(`DELETE FROM tasks WHERE title LIKE 'Call Tom Chen: auto-ship card failed%'`);
    cy.exec(
      'NODE_PATH=$API_DIR/node_modules node cypress/training/setup/online-store-billing-tasks.cjs "$TRAINING_DB" "$TRAINING_WORK/osv-world.json" "http://localhost:$TRAINING_API_PORT"',
      { timeout: 60000 }
    )
      .its('stdout')
      .should('contain', 'paymentStatus=ended');
    signIn('billing', '/schedule/tasks');
    cy.contains('button[role="tab"]', /^Unassigned/, { timeout: 40000 });
    cy.wait(1500);
    startClock();

    line('b01-why');
    line('b02-unassigned', () => tap(() => cy.contains('button[role="tab"]', /^Unassigned/)));
    line('b03-task', () => look(() => cy.contains('a.pims-task-card__title', TITLE, { timeout: 20000 }).parents('article').first(), 4500));
    line('b04-remember');
    line('b05-open', () => tap(() => cy.contains('a.pims-task-card__title', TITLE)));
    line('b06-why', () => look(() => cy.contains('Stripe could not charge', { timeout: 20000 }), 6000));
    line('b07-claim', () => press(() => cy.contains('button', /^Assign to me$/)));
    line('b07b-mine', () => look(() => cy.get('.pims-task-detail__meta', { timeout: 20000 }), 3000));
    offCamera(() => {
      cy.visit('/schedule/inventory/auto-ships');
      cy.contains('h2', 'Auto-ships', { timeout: 40000 });
      cy.wait(800);
    });
    line('b08-list', () => tap(() => cy.contains('button', /^Payment problems$/)));
    line('b09-ended', () =>
      look(() => cy.contains('article.autoship-list__card', 'Tom Chen', { timeout: 20000 }).contains('.mail-queue__badge', 'Ended: card failed'), 4500)
    );
    line('b10-others');
    line('b11-mistakes');
    line('b12-remember');
    finish();
  });
});

/// <reference types="cypress" />
/**
 * Training video, INV-10: open balances, including old eVet invoices
 * (docs/training/scripts/invoicing/INV-10-open-balances-and-evet.md). TEST stack, demo names only: Tom Chen and Biscuit,
 * one open Scout bill and the old eVet invoice #48213 (invoicing-demo.sql). Signed in as a client liaison.
 */
import '../support/e2e';
import { schedulingWorld, signInAsScheduling } from '../support/schedulingWorld';
import { counterBill, resetInvoicingWorld } from './invKit';
import { finish, line, loadNarration, pointAt, startClock, tap } from './trainingKit';

describe('Training: INV-10 open balances and eVet', () => {
  it('INV-10', () => {
    const w = schedulingWorld();
    const client = w.households.B.clientId;
    loadNarration();
    resetInvoicingWorld();
    counterBill(w.households.B.petId, client, ['Office exam']);
    cy.then(() => signInAsScheduling('cl', `/schedule/clients?clientId=${client}&tab=financial`));
    cy.contains('tr.is-click', '#48213', { timeout: 60000 }).should('exist');
    cy.wait(1500);

    startClock();
    line('inv10-01');
    line('inv10-02', () => pointAt(() => cy.contains(/balance due/i).parent(), 3500));
    line('inv10-03');
    line('inv10-04', () => pointAt(() => cy.contains('tr.is-click', '#48213'), 3500));
    line('inv10-05', () => {
      tap(() => cy.contains('tr.is-click', '#48213'));
      cy.contains('eVet invoice #48213', { timeout: 30000 }).should('exist');
    });
    line('inv10-06', () => {
      // A client liaison no longer sees Void on an eVet invoice (only roles with the void permission do).
      cy.contains('button', /^Void$/).should('not.exist');
      pointAt(() => cy.contains('button', 'Edit in Scout'), 4500);
    });
    line('inv10-07', () => pointAt(() => cy.contains('Sends $').filter(':visible').first(), 4500));
    line('inv10-08b', () => tap(() => cy.contains('button', 'Edit in Scout')));
    line('inv10-08c', () => pointAt(() => cy.contains('Scout owns this bill now'), 4500));
    line('inv10-08d', () => pointAt(() => cy.contains(/balance due/i).parent(), 3500));
    line('inv10-08e');
    line('inv10-09');
    line('inv10-10');
    finish();
  });
});

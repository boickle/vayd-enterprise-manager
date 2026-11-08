/// <reference types="cypress" />
/**
 * Training video, INV-16: end of day, today's payments and the bank deposit
 * (docs/training/scripts/invoicing/INV-16-end-of-day.md). TEST stack, demo names only, signed in as the practice manager
 * (Robin Hale). Today's payments come from invoicing-demo.sql: Tom Chen $40 cash and $35 check #1042, and a Rivera $25 card.
 */
import '../support/e2e';
import { schedulingWorld, signInAsScheduling } from '../support/schedulingWorld';
import { resetInvoicingWorld, sql } from './invKit';
import { finish, line, loadNarration, offCamera, pointAt, startClock, tap } from './trainingKit';

describe('Training: INV-16 end of day', () => {
  it('INV-16', () => {
    schedulingWorld();
    loadNarration();
    resetInvoicingWorld();
    // An earlier take's deposit goes away, so the cash and check are undeposited again.
    sql(`DELETE FROM practice_deposit_lines`);
    sql(`DELETE FROM practice_deposits`);
    // Deposits only: the Analytics payments lists are for billing, managers, admin and observer (owner, Nov 8, 2026).
    cy.then(() => signInAsScheduling('manager', '/schedule'));
    cy.contains('a', 'Create deposit', { timeout: 60000 }).should('be.visible');
    cy.wait(2500);

    startClock();
    line('inv16-01', () => pointAt(() => cy.contains('a', 'Create deposit'), 4500));
    line('inv16-02');
    line('inv16-09', () => {
      tap(() => cy.contains('a', 'Create deposit'));
      cy.contains('h5', 'Create deposit', { timeout: 30000 }).should('exist');
      cy.contains('Check #', { timeout: 30000 }).should('exist');
    });
    line('inv16-10', () => pointAt(() => cy.contains('Grab undeposited cash and check payments'), 4500));
    line('inv16-11', () => {
      tap(() => cy.get('#deposit-bank-label').parent().find('[role="combobox"]'));
    });
    line('inv16-11b', () => tap(() => cy.contains('[role="option"]', 'Operating account')));
    line('inv16-12', () => pointAt(() => cy.contains('label', 'Deposited on'), 3500));
    line('inv16-13', () => pointAt(() => cy.contains('.MuiCard-root', 'Undeposited payments').find('table'), 6000));
    line('inv16-14', () => {
      tap(() => cy.contains('tr', /Cash/).find('input[type="checkbox"]').parent());
    });
    line('inv16-15', () => {
      tap(() => cy.contains('tr', '1042').find('input[type="checkbox"]').parent());
    });
    line('inv16-16', () => pointAt(() => cy.contains('Deposit slip draft').parent(), 6000));
    line('inv16-17', () => {
      tap(() => cy.contains('button', /^Create deposit$/));
      cy.contains('Deposit posted to Operating account', { timeout: 30000 }).should('exist');
    });
    line('inv16-18', () => pointAt(() => cy.contains('Deposit posted to Operating account'), 4000));
    // Printing opens a system dialog that would freeze the recording, so the browser's print is a no-op here.
    offCamera(() => cy.window().then((win) => { win.print = () => undefined; }));
    line('inv16-19', () => tap(() => cy.contains('button', 'Print deposit slip')));
    line('inv16-20', () => {
      tap(() => cy.contains('button', /^Close$/));
      pointAt(() => cy.contains('.MuiCard-root', 'Recent deposits'), 4500);
    });
    line('inv16-21');
    finish();
  });
});

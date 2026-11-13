/// <reference types="cypress" />
/**
 * Training video, INV-19: mark a client "Deposit required"
 * (docs/training/scripts/invoicing/INV-19-mark-deposit-required.md). TEST stack, demo names only: Tom Chen and
 * Biscuit, signed in as the manager (Robin Hale). Biscuit has a wellness visit on the next weekday.
 */
import '../support/e2e';
import { schedulingWorld, signInAsScheduling } from '../support/schedulingWorld';
import { resetInvoicingWorld } from './invKit';
import { bookBiscuit, nextWeekdayTen, resetChenDeposits, ymdNy } from './depKit';
import { finish, line, loadNarration, offCamera, pointAt, pointAtInPlace, startClock, tap, typeSlowly } from './trainingKit';

describe('Training: INV-19 mark deposit required', () => {
  it('INV-19', () => {
    const w = schedulingWorld();
    const client = w.households.B.clientId;
    loadNarration();
    resetInvoicingWorld();
    resetChenDeposits();
    const day = nextWeekdayTen();
    let appt = 0;
    bookBiscuit(day).then((id) => (appt = id));
    cy.then(() => signInAsScheduling('manager', `/schedule/clients?clientId=${client}`));
    cy.contains('button', '+ Mark deposit required', { timeout: 60000 }).should('exist');
    cy.wait(1500);

    const dialog = () => cy.get('.app-dialog');
    startClock();
    line('inv19-01');
    line('inv19-02', () => pointAt(() => cy.contains('button', '+ Mark deposit required'), 3500));
    line('inv19-03', () => {
      tap(() => cy.contains('button', '+ Mark deposit required'));
      dialog().should('contain', 'CLs will see this when booking');
    });
    line('inv19-04', () => pointAt(() => dialog().find('.app-dialog__body'), 3500));
    line('inv19-05', () => typeSlowly(() => dialog().find('.app-dialog__field'), 'Two unpaid visits'));
    line('inv19-06', () => tap(() => dialog().contains('button', 'Mark deposit required')));
    offCamera(() => cy.get('[data-testid="client-deposit-required"]', { timeout: 30000 }).should('contain', 'Two unpaid visits'));
    line('inv19-07', () => pointAt(() => cy.get('[data-testid="client-deposit-required"]'), 5000));
    line('inv19-08', () => pointAt(() => cy.get('[data-testid="client-deposit-required"]').contains('button', 'Clear'), 3500));
    // The schedule, on Biscuit's visit day.
    offCamera(() => {
      cy.then(() => cy.visit(`/schedule/scheduler?fromMyDay=1&date=${ymdNy(day)}&provider=${w.doctors.A}`));
      cy.contains('button', /^Day$/, { timeout: 60000 }).click();
      cy.wait(2500);
      cy.then(() =>
        cy.get(`[data-appt-id="${appt}"]`, { timeout: 30000 }).first().then(($el) => $el[0].scrollIntoView({ block: 'center' }))
      );
      cy.wait(1500);
    });
    line('inv19-09', () => {
      cy.then(() => pointAt(() => cy.get(`[data-appt-id="${appt}"]`).first(), 1200));
      cy.then(() => cy.get(`[data-appt-id="${appt}"]`).first().trigger('mouseover', { scrollBehavior: false }).trigger('mousemove', { scrollBehavior: false }));
      cy.get('.scheduler-tooltip-vh-alerts', { timeout: 15000 }).should('contain', 'DEPOSIT REQUIRED');
    });
    line('inv19-10', () => pointAtInPlace(() => cy.get('.scheduler-tooltip-vh-alerts'), 5000));
    line('inv19-11');
    line('inv19-12');
    finish();
  });
});

/// <reference types="cypress" />
/**
 * Training video, INV-15: manual discounts and employer promotions
 * (docs/training/scripts/invoicing/INV-15-manual-discounts.md). TEST stack, demo names only: Tom Chen and Biscuit,
 * signed in as the manager (Robin Hale). Part one: an Office exam added on the ledger and discounted by hand. Part two:
 * Biscuit's visit checkout, where the employer promotion in invoicing-demo.sql waits for confirmation.
 */
import '../support/e2e';
import { schedulingApi, schedulingWorld, signInAsScheduling } from '../support/schedulingWorld';
import { catalogId, counterBill, openVisit, resetInvoicingWorld, setBillBranch } from './invKit';
import { finish, line, loadNarration, offCamera, pointAt, startClock, tap, typeSlowly } from './trainingKit';

describe('Training: INV-15 manual discounts', () => {
  it('INV-15', () => {
    const w = schedulingWorld();
    const client = w.households.B.clientId;
    const biscuit = w.households.B.petId;
    const pid = w.practiceId;
    loadNarration();
    resetInvoicingWorld();

    let inv = '';
    let appt = 0;
    counterBill(biscuit, client, []).then((id) => (inv = id));
    openVisit(biscuit, client, 'Wellness exam', 90).then(({ appt: a, enc }) => {
      appt = a;
      schedulingApi('cl', 'POST', '/visit-invoices', { practiceId: pid, appointmentId: a, clientId: client }).then(() =>
        catalogId('Office exam').then((c) =>
          schedulingApi('doctorA', 'POST', `/soap-encounters/${enc}/orders`, {
            practiceId: pid, name: 'Office exam', catalogItemId: c.id, catalogItemType: c.type, qty: 1, kind: 'treatment', state: 'accepted', unitPrice: 75,
          })
        )
      );
    });
    cy.then(() => setBillBranch(client));
    cy.then(() => signInAsScheduling('manager', `/schedule/clients?clientId=${client}&tab=financial&invoice=${inv}`));
    // Add the Office exam on the screen, so the regular price is kept for the strike-through (off camera).
    cy.get('input[placeholder^="Add a charge for"]', { timeout: 60000 }).first().type('Office exam');
    cy.contains('li', 'Office exam', { timeout: 30000 }).click();
    cy.contains('.client-fin__price-shown-row', '$75.00', { timeout: 30000 }).should('exist');
    cy.wait(1500);

    startClock();
    line('inv15-01', () => pointAt(() => cy.contains('.client-fin__price-shown-row', '$75.00'), 3500));
    line('inv15-02');
    line('inv15-03', () => tap(() => cy.get('button[title="Edit unit price"]').first()));
    line('inv15-04', () => typeSlowly(() => cy.get('input.client-fin__price'), '{selectall}60{enter}'));
    offCamera(() => cy.contains('.app-dialog', 'Why is this discounted?', { timeout: 30000 }).should('exist'));
    line('inv15-05', () => pointAt(() => cy.contains('.app-dialog', 'saved on the discounts report'), 4500));
    line('inv15-06', () => typeSlowly(() => cy.get('.app-dialog textarea, .app-dialog input').first(), 'Professional courtesy'));
    line('inv15-07', () => {
      tap(() => cy.contains('.app-dialog button', /^(Apply discount|Add discount)$/));
      cy.contains('.app-dialog', 'Why is this discounted?').should('not.exist');
    });
    line('inv15-08', () => pointAt(() => cy.contains('.client-fin__price-shown-row', '$60.00'), 3500));
    line('inv15-08b', () => tap(() => cy.contains('summary', 'Staff audit')));
    line('inv15-08c', () => pointAt(() => cy.contains('Price changed on'), 5000));
    offCamera(() => {
      cy.then(() => cy.visit(`/schedule/soap/${appt}/${biscuit}/checkout?clientId=${client}`));
      cy.contains('[data-testid="employer-promotion-line"]', 'Confirm promotion', { timeout: 60000 }).should('exist');
      cy.wait(1500);
    });
    line('inv15-09', () => pointAt(() => cy.get('[data-testid="employer-promotion-line"]'), 6000));
    line('inv15-10', () => {
      tap(() => cy.contains('button', 'Confirm promotion'));
      cy.contains('Confirm promotion').should('not.exist');
    });
    line('inv15-11', () => {
      pointAt(() => cy.contains('.soap-invoice-line', 'Employer promotion'), 2500);
      pointAt(() => cy.get('.soap-invoice-row.total'), 2500);
    });
    line('inv15-12');
    finish();
  });
});

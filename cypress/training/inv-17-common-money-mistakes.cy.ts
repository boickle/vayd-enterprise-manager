/// <reference types="cypress" />
/**
 * Training video, INV-17: the most common money mistakes
 * (docs/training/scripts/invoicing/INV-17-common-money-mistakes.md). TEST stack, demo names only: Maria Rivera and Maple
 * (on the Adult plan), signed in as the manager (Robin Hale, so the Create deposit menu link shows). Maria has a saved
 * Stripe test card and $30 of account credit. Pointing only, except opening Type card manually and cancelling it.
 */
import '../support/e2e';
import { schedulingApi, schedulingWorld, signInAsScheduling } from '../support/schedulingWorld';
import { catalogId, clearAccountCredit, giveSavedCard, openVisit, resetInvoicingWorld, setBillBranch } from './invKit';
import { finish, line, loadNarration, offCamera, pointAt, startClock, tap } from './trainingKit';

describe('Training: INV-17 common money mistakes', () => {
  it('INV-17', () => {
    const w = schedulingWorld();
    const client = w.households.A.clientId;
    const [maple] = w.households.A.activePetIds;
    const pid = w.practiceId;
    loadNarration();
    resetInvoicingWorld();
    clearAccountCredit(client);
    giveSavedCard(client, `maria.rivera.inv17.${Date.now()}@example.com`, 'Maria Rivera');
    schedulingApi('manager', 'POST', '/visit-invoices/account-adjustment', {
      practiceId: pid, clientId: client, amount: -30, description: 'Goodwill credit for a late visit',
    });

    let appt = 0;
    openVisit(maple, client, 'Annual exam', 90).then(({ appt: a, enc }) => {
      appt = a;
      schedulingApi('cl', 'POST', '/visit-invoices', { practiceId: pid, appointmentId: a, clientId: client }).then(() => {
        setBillBranch(client);
        const order = (name: string, body: Record<string, unknown>) =>
          catalogId(name).then((c) =>
            schedulingApi('doctorA', 'POST', `/soap-encounters/${enc}/orders`, {
              practiceId: pid, name, catalogItemId: c.id, catalogItemType: c.type, qty: 1, kind: 'treatment', state: 'accepted', ...body,
            })
          );
        order('Office exam', { unitPrice: 0, isCovered: true });
        order('Nail trim', { unitPrice: 22.5 });
        order('Dental chews', { unitPrice: 21.6 });
      });
    });
    cy.then(() => signInAsScheduling('manager', `/schedule/soap/${appt}/${maple}/checkout?clientId=${client}`));
    cy.contains('.soap-invoice-row.total', '$', { timeout: 60000 }).should('exist');
    cy.contains('.soap-checkout-actions button', 'Card on file', { timeout: 60000 }).should('not.be.disabled');
    cy.contains('.soap-invoice-line', 'Dental chews', { timeout: 30000 }).should('exist');
    cy.wait(1500);

    const btn = (label: string) => cy.contains('.soap-checkout-actions button', label);
    startClock();
    line('inv17-01', () => pointAt(() => cy.get('.soap-invoice-row.total'), 3500));
    line('inv17-02', () => pointAt(() => btn('Card on file'), 3500));
    line('inv17-03', () => pointAt(() => cy.get('.soap-invoice-row.total'), 4500));
    line('inv17-04', () => pointAt(() => cy.contains('.soap-invoice-line', 'Nail trim'), 4500));
    line('inv17-05', () => {
      pointAt(() => btn('Gift card'), 2200);
      pointAt(() => btn('Account credit'), 2200);
    });
    line('inv17-06', () => pointAt(() => btn('Tap to Pay'), 4000));
    line('inv17-07');
    line('inv17-08', () => {
      tap(() => btn('Type card manually'));
      cy.contains('Owner agrees we may keep this card on file', { timeout: 30000 }).should('exist');
    });
    line('inv17-09', () => pointAt(() => cy.contains('Owner agrees we may keep this card on file'), 4500));
    line('inv17-10', () => {
      tap(() => cy.contains('.virtual-terminal__actions button', 'Cancel'));
      cy.get('.virtual-terminal').should('not.exist');
    });
    line('inv17-11', () => pointAt(() => cy.contains('a', 'Create deposit'), 4000));
    line('inv17-12');
    line('inv17-13');
    line('inv17-14');
    finish();
  });
});

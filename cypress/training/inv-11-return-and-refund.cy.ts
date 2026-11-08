/// <reference types="cypress" />
/**
 * Training video, INV-11: return items and refund, card first then account credit
 * (docs/training/scripts/invoicing/INV-11-return-and-refund.md). TEST stack on Stripe TEST mode, demo names only: Maria
 * Rivera and Maple, signed in as the manager. The paid bill is made through the API: 1 bag of Prescription diet at $60
 * (lot DIET-2611), paid in full on a Stripe test Visa (the simple one-case version). Needs invoicing-demo.sql.
 */
import '../support/e2e';
import { schedulingApi, schedulingWorld, signInAsScheduling } from '../support/schedulingWorld';
import { catalogId, counterBill, giveSavedCard, resetInvoicingWorld, setBillBranch, sql } from './invKit';
import { finish, line, loadNarration, offCamera, pointAt, startClock, tap, typeSlowly } from './trainingKit';

describe('Training: INV-11 return and refund', () => {
  it('INV-11', () => {
    const w = schedulingWorld();
    const client = w.households.A.clientId;
    const [maple] = w.households.A.activePetIds;
    const pid = w.practiceId;
    loadNarration();
    resetInvoicingWorld();
    giveSavedCard(client, `maria.rivera.inv11.${Date.now()}@example.com`, 'Maria Rivera');

    let inv = '';
    let invNo = '';
    counterBill(maple, client, []).then((id) => {
      inv = id;
      catalogId('Prescription diet, 8 lb bag').then((c) =>
        sql(`SELECT id FROM inventory_lot_balances WHERE "lotNumber"='DIET-2611' LIMIT 1`).then((lot) =>
          schedulingApi('cl', 'POST', `/visit-invoices/${id}/lines`, {
            practiceId: pid, patientId: maple, description: 'Prescription diet, 8 lb bag', qty: 1, unitPrice: 60,
            catalogItemId: c.id, catalogItemType: c.type, providerEmployeeId: w.doctors.A, inventoryLotBalanceId: Number(lot),
          })
        )
      );
    });
    cy.then(() => setBillBranch(client));
    cy.then(() => schedulingApi('cl', 'POST', `/visit-payments/${inv}/charge-saved-card`, { practiceId: pid }));
    cy.then(() => sql(`SELECT "scoutInvoiceNumber" || '|' || status || '|' || total FROM visit_invoices WHERE id='${inv}'`).then((r) => {
      invNo = String(r).split('|')[0];
      expect(String(r), 'bill is paid').to.contain('|paid|60');
    }));
    cy.then(() => signInAsScheduling('manager', `/schedule/clients?clientId=${client}&tab=financial`));
    cy.contains('tr.is-click', '#', { timeout: 60000 }).should('exist');
    cy.wait(1500);

    const returnItems = () => cy.contains('button', 'Return items');
    const confirm = (re: RegExp) => cy.contains('.app-dialog button', re);
    startClock();
    line('inv11-01');
    line('inv11-02', () => {
      cy.then(() => tap(() => cy.contains('tr.is-click', `#${invNo}`)));
      returnItems().should('exist');
    });
    line('inv11-03', () => {
      tap(() => returnItems());
      cy.contains('Paid on this invoice', { timeout: 30000 }).should('exist');
    });
    line('inv11-04', () => pointAt(() => cy.contains('Paid on this invoice'), 4000));
    line('inv11-05', () => typeSlowly(() => cy.get('input[placeholder^="≤"]').first(), '1'));
    line('inv11-06', () => pointAt(() => cy.contains('Refund total'), 5000));
    line('inv11-07', () => tap(() => cy.contains('button', /^Refund \$60\.00 to card$/)));
    line('inv11-08', () => pointAt(() => cy.contains('.app-dialog', 'Return the selected items'), 3000));
    line('inv11-09', () => {
      tap(() => confirm(/^Refund \$60\.00$/));
      cy.contains('Returned items and refunded', { timeout: 90000 }).should('exist');
    });
    line('inv11-10', () => cy.wait(1000).then(() => pointAt(() => cy.contains('tr.is-click', `#${invNo}`), 4500)));
    line('inv11-11', () => pointAt(() => cy.contains('Returned items and refunded'), 4500));
    line('inv11-12');
    finish();
  });
});

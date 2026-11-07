/// <reference types="cypress" />
/**
 * Training video, INV-11: return items and refund, card first then account credit
 * (docs/training/scripts/invoicing/INV-11-return-and-refund.md). TEST stack on Stripe TEST mode, demo names only: Maria
 * Rivera and Maple, signed in as the manager. The paid bill is made through the API: 2 bags of Prescription diet at $60
 * (lot DIET-2611), paid $50 account credit and then $70 on a Stripe test Visa. Needs invoicing-demo.sql.
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
    // Credit already on her account (the bill uses $50 of it); clear what earlier takes left so it reads $0 -> $50 at the end.
    sql(`UPDATE visit_invoice_tenders SET "isDeleted"=true WHERE method='account_credit' AND "invoiceId" IN (SELECT id FROM visit_invoices WHERE "clientId"=${client} AND "isDeleted"=false AND status<>'paid')`);

    let inv = '';
    let invNo = '';
    schedulingApi('manager', 'POST', '/visit-invoices/account-adjustment', {
      practiceId: pid, clientId: client, amount: -50, description: 'Goodwill credit for a late visit',
    });
    counterBill(maple, client, []).then((id) => {
      inv = id;
      catalogId('Prescription diet, 8 lb bag').then((c) =>
        sql(`SELECT id FROM inventory_lot_balances WHERE "lotNumber"='DIET-2611' LIMIT 1`).then((lot) =>
          schedulingApi('cl', 'POST', `/visit-invoices/${id}/lines`, {
            practiceId: pid, patientId: maple, description: 'Prescription diet, 8 lb bag', qty: 2, unitPrice: 60,
            catalogItemId: c.id, catalogItemType: c.type, providerEmployeeId: w.doctors.A, inventoryLotBalanceId: Number(lot),
          })
        )
      );
    });
    cy.then(() => setBillBranch(client));
    cy.then(() => schedulingApi('manager', 'POST', `/visit-invoices/${inv}/tenders`, { practiceId: pid, method: 'account_credit', amount: 50 }));
    cy.then(() => schedulingApi('cl', 'POST', `/visit-payments/${inv}/charge-saved-card`, { practiceId: pid }));
    cy.then(() => sql(`SELECT "scoutInvoiceNumber" || '|' || status || '|' || total FROM visit_invoices WHERE id='${inv}'`).then((r) => {
      invNo = String(r).split('|')[0];
      expect(String(r), 'bill is paid').to.contain('|paid|120');
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
    line('inv11-03');
    line('inv11-04', () => {
      tap(() => returnItems());
      cy.contains('Paid on this invoice', { timeout: 30000 }).should('exist');
    });
    line('inv11-05', () => pointAt(() => cy.contains('Paid on this invoice'), 5000));
    line('inv11-06', () => typeSlowly(() => cy.get('input[placeholder^="≤"]').first(), '1'));
    line('inv11-07', () => pointAt(() => cy.contains('Refund total'), 5000));
    line('inv11-08', () => tap(() => cy.contains('button', /^Refund \$60\.00 to card$/)));
    line('inv11-09', () => pointAt(() => cy.contains('.app-dialog', 'Return the selected items'), 3000));
    line('inv11-10', () => {
      tap(() => confirm(/^Refund \$60\.00$/));
      cy.contains('Returned items and refunded', { timeout: 90000 }).should('exist');
    });
    line('inv11-11', () => pointAt(() => cy.contains('Returned items and refunded'), 5000));
    line('inv11-12', () => {
      tap(() => returnItems());
      cy.contains('can still go back to the card', { timeout: 30000 }).should('exist');
    });
    line('inv11-13', () => pointAt(() => cy.contains('Paid on this invoice'), 5000));
    line('inv11-14', () => typeSlowly(() => cy.get('input[placeholder^="≤"]').first(), '1'));
    line('inv11-15', () => pointAt(() => cy.contains('More than the card can take'), 5000));
    line('inv11-16', () => tap(() => cy.contains('button', /^Refund \$60\.00 \(/)));
    line('inv11-17', () => pointAt(() => cy.contains('.app-dialog', 'The card part goes back through Stripe'), 3500));
    line('inv11-18', () => {
      tap(() => confirm(/^Refund \$60\.00$/));
      cy.contains('back as account credit.', { timeout: 90000 }).should('exist');
    });
    line('inv11-19', () => cy.wait(1500).then(() => pointAt(() => cy.contains('tr.is-click', `#${invNo}`), 6000)));
    line('inv11-20');
    line('inv11-21');
    finish();
  });
});

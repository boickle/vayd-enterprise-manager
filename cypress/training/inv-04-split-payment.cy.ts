/// <reference types="cypress" />
/**
 * Training video, INV-04: split payment, gift card, account credit, then a card
 * (docs/training/scripts/invoicing/INV-04-split-payment.md). TEST stack on Stripe TEST mode with Stripe's test Visa.
 * Demo names only: Maria Rivera and Maple. Needs invoicing-demo.sql.
 */
import '../support/e2e';
import { schedulingApi, schedulingWorld, signInAsScheduling } from '../support/schedulingWorld';
import { catalogId, counterBill, giveSavedCard, openVisit, resetInvoicingWorld, setBillBranch, sql } from './invKit';
import { choose, finish, line, loadNarration, offCamera, pointAt, startClock, tap, typeSlowly } from './trainingKit';

describe('Training: INV-04 split payment', () => {
  it('INV-04', () => {
    const w = schedulingWorld();
    const [maple] = w.households.A.activePetIds;
    const client = w.households.A.clientId;
    const pid = w.practiceId;
    loadNarration();
    resetInvoicingWorld();
    // Maria's saved Visa (a fresh email, so Stripe holds only this card), a $50 gift card and $30 of account credit.
    giveSavedCard(client, `maria.rivera.inv04.${Date.now()}@example.com`, 'Maria Rivera');
    let code = '';
    schedulingApi<{ id: string }>('manager', 'POST', `/practice/${pid}/gift-cards`, { faceValue: 50, reason: 'Training demo gift card' }).then((res) =>
      sql(`SELECT code FROM gift_cards WHERE id='${res.body.id}'`).then((c) => (code = String(c).trim().replace(/[^A-Za-z0-9]/g, '')))
    );
    schedulingApi('manager', 'POST', '/visit-invoices/account-adjustment', {
      practiceId: pid, clientId: client, amount: -30, description: 'Goodwill credit for a late visit',
    });

    let appt = 0;
    let invoiceId = '';
    openVisit(maple, client, 'Dental X-rays', 90).then(({ appt: a, enc }) => {
      appt = a;
      schedulingApi<{ id: string }>('cl', 'POST', '/visit-invoices', { practiceId: pid, appointmentId: a, clientId: client }).then((inv) => {
        invoiceId = inv.body.id;
        setBillBranch(client);
        catalogId('Dental X-rays').then((c) =>
          schedulingApi('doctorA', 'POST', `/soap-encounters/${enc}/orders`, {
            practiceId: pid, name: 'Dental X-rays', catalogItemId: c.id, catalogItemType: c.type, qty: 1, kind: 'treatment', state: 'accepted', unitPrice: 162,
          })
        );
      });
    });
    cy.then(() => signInAsScheduling('cl', `/schedule/soap/${appt}/${maple}/checkout?clientId=${client}`));
    cy.contains('.soap-invoice-row.total', '$162.00', { timeout: 60000 }).should('exist');
    cy.contains('.soap-checkout-actions button', 'Card on file', { timeout: 60000 }).should('not.be.disabled');
    cy.wait(1500);

    const btn = (label: string) => cy.contains('.soap-checkout-actions button', label);
    startClock();

    line('inv04-01');
    line('inv04-02', () => pointAt(() => cy.get('.soap-invoice-row.total'), 3500));
    line('inv04-03');
    line('inv04-04', () => tap(() => btn('Gift card')));
    line('inv04-05', () => {
      cy.then(() => typeSlowly(() => cy.get('.gift-card-tender input[placeholder="Gift card code"]'), code));
    });
    line('inv04-06', () => tap(() => cy.contains('.gift-card-tender button', 'Check balance')));
    line('inv04-07', () => {
      cy.contains('.gift-card-tender', 'has', { timeout: 30000 }).should('exist');
      pointAt(() => cy.contains('.gift-card-tender label', 'Use $'), 4500);
    });
    line('inv04-08', () => tap(() => cy.contains('.gift-card-tender button', 'Apply gift card')));
    line('inv04-09', () => {
      pointAt(() => cy.contains('Took $50.00 from gift card'), 4500);
    });
    line('inv04-10', () => pointAt(() => cy.get('[data-testid="checkout-balance-due"]'), 3500));
    line('inv04-11', () => pointAt(() => btn('Account credit'), 4500));
    line('inv04-12', () => tap(() => btn('Account credit')));
    line('inv04-14', () => pointAt(() => cy.contains('.account-credit-tender', 'available'), 4500));
    line('inv04-13', () => tap(() => cy.contains('.account-credit-tender button', 'Apply credit')));
    line('inv04-15', () => {
      cy.contains('Used $30.00 of account credit').should('exist');
      pointAt(() => cy.get('[data-testid="checkout-balance-due"]'), 3500);
    });
    line('inv04-16', () => pointAt(() => btn('Card on file'), 4000));
    line('inv04-17', () => tap(() => btn('Card on file')));
    line('inv04-17b', () => pointAt(() => cy.contains('.soap-checkout-card-confirm button', /Charge \$/), 4500));
    line('inv04-17c', () => tap(() => cy.contains('.soap-checkout-card-confirm button', /Charge \$/)));
    offCamera(() => cy.get('[data-testid="checkout-paid-in-full"]', { timeout: 90000 }).should('exist'));
    line('inv04-17d', () => pointAt(() => cy.get('.soap-invoice-paid-in-full-title'), 3000));
    line('inv04-17e', () => pointAt(() => cy.get('[data-testid="checkout-paid-in-full"] ul'), 5000));
    // The ledger: the paid bill, then a second open bill.
    offCamera(() => {
      cy.then(() => cy.visit(`/schedule/clients?clientId=${client}&tab=financial&invoice=${invoiceId}`));
      cy.contains(/Gift card/i, { timeout: 60000 }).should('exist');
      cy.wait(1500);
    });
    line('inv04-18', () => pointAt(() => cy.contains(/Gift card/i).filter(':visible').first(), 5000));
    let second = '';
    offCamera(() => {
      counterBill(maple, client, ['Nail trim']).then((id) => (second = id));
      cy.then(() => cy.visit(`/schedule/clients?clientId=${client}&tab=financial&invoice=${second}`));
      cy.contains('label', 'Method', { timeout: 60000 }).find('select option').should('contain.text', 'Card on file');
      cy.wait(1000);
    });
    line('inv04-19', () => choose(() => cy.contains('label', 'Method').find('select'), 'Cash'));
    line('inv04-20', () => {
      pointAt(() => cy.contains('label', 'Amount'), 2500);
      pointAt(() => cy.contains('label', 'Cash received'), 2500);
    });
    line('inv04-21');
    finish();
  });
});

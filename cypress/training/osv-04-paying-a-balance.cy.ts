/// <reference types="cypress" />
/**
 * Training video OSV-04: paying an open bill in the portal, and old eVet bills. TEST stack, Stripe TEST mode.
 * Tom Chen has an $85 open eVet bill (setup/online-store-demo.cjs). Maria gets an open Scout bill (an office exam for
 * Maple) and a saved test Visa (from a store order bought before the clock starts), then pays the bill online.
 */
import '../support/e2e';
import { schedulingApi } from '../support/schedulingWorld';
import { buyAsMaria, look, osv, resetStoreData, schedulingWorld, signIn, sql } from './osvTraining';
import { finish, line, loadNarration, offCamera, pointAt, startClock, tap } from './trainingKit';

describe('Training: OSV-04 paying a balance in the portal', () => {
  it('OSV-04', () => {
    const o = osv();
    const w = schedulingWorld();
    loadNarration();
    resetStoreData();
    // Clear open Scout bills an earlier take left on the Riveras, then give Maria one open bill.
    sql(`UPDATE visit_invoices SET "isDeleted"=true WHERE "clientId"=${o.clients.rivera} AND "isDeleted"=false`);
    buyAsMaria({ tab: 'Dental', item: 'Dental chews', pet: 'Maple', autoship: false });
    sql(`SELECT id || ' ' || price FROM procedures WHERE name='Office exam' AND "isDeleted"=false ORDER BY id LIMIT 1`).then((row) => {
      const [procId, price] = String(row).trim().split(' ');
      schedulingApi<{ id: string }>('cl', 'POST', '/visit-invoices/counter', {
        practiceId: w.practiceId, patientId: o.pets.maple, clientId: o.clients.rivera,
      }).then((res) => {
        const id = res.body.id;
        schedulingApi('cl', 'POST', `/visit-invoices/${id}/lines`, {
          practiceId: w.practiceId, patientId: o.pets.maple, description: 'Office exam', qty: 1, unitPrice: Number(price),
          catalogItemId: Number(procId), catalogItemType: 'procedure', providerEmployeeId: w.doctors.A,
        });
        schedulingApi('cl', 'POST', `/visit-invoices/${id}/finalize`, { practiceId: w.practiceId }, false);
      });
    });
    signIn('chen', '/client-portal');
    cy.contains('.pp-greeting-name', 'Tom', { timeout: 40000 });
    cy.contains('section.pp-account', 'Your balance', { timeout: 30000 });
    cy.wait(1500);
    startClock();

    line('b01-why');
    line('b02-tom', () => pointAt(() => cy.get('.pp-greeting')));
    line('b03-balance', () => pointAt(() => cy.contains('.pp-stat-k', 'Your balance'), 3500));
    line('b04-held', () => pointAt(() => cy.get('.vayd-store__evet-held'), 5000));
    line('b05-remember');
    offCamera(() => {
      signIn('cl', `/schedule/clients?clientId=${o.clients.chen}&tab=financial`);
      cy.contains(/48213|eVet/, { timeout: 60000 });
      cy.wait(1500);
    });
    line('b06-scout', () => look(() => cy.contains('tr', /48213/), 4500));
    line('b07-take');
    // Owner (Nov 9): pay links work for eVet bills too.
    line('b07b-link', () => look(() => cy.contains('button', /^Email pay link$/, { timeout: 20000 }).parent(), 4000));
    offCamera(() => {
      signIn('client', '/client-portal');
      cy.contains('.pp-greeting-name', 'Maria', { timeout: 40000 });
      cy.contains('section.pp-account', 'Your balance', { timeout: 30000 });
      cy.wait(1200);
    });
    line('b08-maria', () => pointAt(() => cy.contains('.pp-stat-k', 'Your balance'), 3500));
    line('b09-paynow', () => tap(() => cy.contains('section.pp-account button', /^Pay now$/)));
    line('b10-card', () => look(() => cy.get('.pp-account__card-on-file', { timeout: 20000 }), 4000));
    line('b11-pay', () => tap(() => cy.contains('section.pp-account button', /^Pay \$/)));
    line('b12-paid', () => {
      look(() => cy.get('.pp-account__note', { timeout: 60000 }), 4000);
    });
    line('b13-mistakes');
    line('b14-remember');
    finish();
  });
});

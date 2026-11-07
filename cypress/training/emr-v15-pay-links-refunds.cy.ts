/// <reference types="cypress" />
/**
 * Training video, EMR V15: pay links, refunds, and why a paid invoice can't be voided
 * (docs/training/emr-visit-workflow-video-script.md). TEST stack on Stripe TEST mode (TRAINING_STRIPE=test): the paid
 * bill is paid with Stripe's test Visa, and the refund is a test-mode refund. Demo names: Tom Chen and Biscuit,
 * Casey Morgan (client liaison), and the demo manager for the void.
 */
import '../support/e2e';
import { resetSeededHouseholdsInDb, schedulingApi, schedulingWorld, signInAsScheduling } from '../support/schedulingWorld';
import { finish, line, loadNarration, offCamera, pointAt, startClock, tap, typeSlowly } from './trainingKit';

describe('Training: EMR V15 pay links and refunds', () => {
  it('V15', () => {
    const w = schedulingWorld();
    const client = w.households.B.clientId;
    const biscuit = w.households.B.petId;
    const pid = w.practiceId;
    loadNarration();
    resetSeededHouseholdsInDb();
    const db = String(Cypress.env('SCH_DB'));
    expect(db, 'CYPRESS_SCH_DB must be a vayd_api_test* database').to.match(/^vayd_api_test[A-Za-z0-9_]*$/);
    const sql = (q: string) => cy.exec(`psql -qAt -d ${db} -c "${q.replace(/"/g, '\\"')}"`).its('stdout');
    // Texts allowed for the demo household, so the pay-link text has no "Do not SMS" warning.
    sql(`UPDATE clients SET "doNotSms"=false, "smsOptOut"=false, "phone1SmsEnabled"=true WHERE id=${client}`);
    // Clear bills an earlier take left on the Chens.
    sql(`UPDATE visit_invoices SET "isDeleted"=true WHERE "clientId"=${client} AND "isDeleted"=false`);
    sql(
      `INSERT INTO procedures (name, price, cost, "taxLevelValue", "practiceId", "pimsId", "pimsType", "isActive", "isDeleted")
       SELECT 'Ear recheck', 65, 0, 0, 1, 'training-v15-recheck', 'scout', true, false
        WHERE NOT EXISTS (SELECT 1 FROM procedures WHERE "pimsId"='training-v15-recheck')`
    );
    const addLine = (invoiceId: string, name: string) =>
      sql(`SELECT id || ' ' || price FROM procedures WHERE name='${name}' AND "isDeleted"=false ORDER BY id LIMIT 1`).then((row) => {
        const [id, price] = String(row).trim().split(' ');
        return schedulingApi('cl', 'POST', `/visit-invoices/${invoiceId}/lines`, {
          practiceId: pid, patientId: biscuit, description: name, qty: 1, unitPrice: Number(price),
          catalogItemId: Number(id), catalogItemType: 'procedure', providerEmployeeId: w.doctors.A,
        });
      });
    let paidId = '';
    let owedId = '';
    // The bill Tom paid by card (Stripe test Visa): an office exam and an ear recheck.
    schedulingApi<{ id: string }>('cl', 'POST', '/visit-invoices/counter', { practiceId: pid, patientId: biscuit, clientId: client }).then((res) => {
      paidId = res.body.id;
      addLine(paidId, 'Office exam');
      addLine(paidId, 'Ear recheck');
      cy.then(() =>
        schedulingApi<{ status: string }>('cl', 'POST', `/visit-payments/${paidId}/charge-keyed-card`, { practiceId: pid, paymentMethodId: 'pm_card_visa' })
          .its('body.status')
          .should('eq', 'paid')
      );
    });
    // The bill he still owes.
    cy.then(() =>
      schedulingApi<{ id: string }>('cl', 'POST', '/visit-invoices/counter', { practiceId: pid, patientId: biscuit, clientId: client }).then((res) => {
        owedId = res.body.id;
        expect(owedId).not.to.eq(paidId);
        addLine(owedId, 'Ear recheck');
      })
    );
    const billing = (invoiceId: string) => `/schedule/clients?clientId=${client}&tab=financial&invoice=${invoiceId}`;
    cy.then(() => signInAsScheduling('cl', billing(owedId)));
    cy.contains('button', 'Text pay link', { timeout: 60000 }).should('exist');
    cy.wait(2000);

    startClock();
    line('v15-01');
    line('v15-02', () => pointAt(() => cy.get('.client-fin__bal-value').first(), 4000));
    line('v15-03', () => {
      tap(() => cy.contains('.client-fin__pay-links--ledger button', 'Text pay link'));
    });
    // Making the link waits on Stripe (test mode can take several seconds): cut from the video.
    offCamera(() => cy.get('[role="dialog"] textarea', { timeout: 60000 }).invoke('val').should('match', /http/));
    line('v15-04', () => pointAt(() => cy.get('[role="dialog"] textarea'), 3500));
    line('v15-04b', () => tap(() => cy.get('[role="dialog"]').contains('button', 'Cancel')));
    line('v15-04c', () => {
      tap(() => cy.get('[role="dialog"]').contains('button', "Don't send"));
      cy.get('[role="dialog"]').should('not.exist');
    });
    line('v15-05', () => pointAt(() => cy.contains('.client-fin__pay-links--ledger button', 'Email pay link'), 5000));
    offCamera(() => {
      cy.then(() => cy.visit(billing(paidId)));
      cy.contains('button', /^Refund$/, { timeout: 60000 }).should('exist');
      cy.wait(1500);
    });
    // The innermost visible element holding this text (not a big container around it).
    const deepest = (text: string) =>
      cy
        .get('body')
        .find(`*:contains("${text}")`)
        .filter(':visible')
        .filter((_, el) => !Array.from(el.children).some((c) => (c.textContent ?? '').includes(text)));
    line('v15-06', () => pointAt(() => cy.contains('button', /^Refund$/), 3000));
    line('v15-07', () => {
      tap(() => cy.contains('button', /^Refund$/));
      cy.contains('h4', 'Refund payment').should('exist');
    });
    const refundPanel = () => cy.contains('h4', 'Refund payment').parent();
    line('v15-08', () => {
      refundPanel().find('input[type="number"]').first().clear();
      typeSlowly(() => refundPanel().find('input[type="number"]').first(), '20');
    });
    line('v15-09', () => typeSlowly(() => refundPanel().find('input[placeholder^="e.g. Client request"]'), 'Recheck was shorter than planned'));
    line('v15-09b', () => pointAt(() => refundPanel().find('label.client-fin__check input'), 4000));
    line('v15-10', () => tap(() => refundPanel().contains('button', 'Process refund')));
    // The refund waits on Stripe: cut from the video.
    offCamera(() => {
      cy.contains('Refund: Recheck was shorter than planned', { timeout: 90000 }).should('exist');
      cy.wait(800);
    });
    line('v15-11', () => pointAt(() => deepest('Refunded $20.00').last(), 5000));
    line('v15-11b', () => {
      pointAt(() => cy.contains('Refund: Recheck was shorter than planned').filter(':visible').first(), 5500);
    });
    line('v15-12', () => pointAt(() => cy.contains('button', 'Return items').first(), 5000));
    line('v15-13', () => pointAt(() => cy.contains('button', 'New invoice').first(), 5000));
    offCamera(() => {
      cy.then(() => signInAsScheduling('manager', billing(paidId)));
      cy.contains('button', 'Void invoice', { timeout: 60000 }).should('exist');
      cy.wait(1500);
    });
    line('v15-14', () => {
      tap(() => cy.contains('button', 'Void invoice'));
      cy.get('[role="dialog"]', { timeout: 20000 }).should('exist');
    });
    line('v15-15', () => typeSlowly(() => cy.get('[role="dialog"]').find('input, textarea').filter(':visible').first(), 'Family asked for their money back'));
    line('v15-16', () => {
      tap(() => cy.get('[role="dialog"]').contains('button', /^Void$/));
    });
    offCamera(() => cy.contains('p.client-fin__err', 'Refund the card payment first', { timeout: 60000 }).should('be.visible'));
    line('v15-17', () => pointAt(() => cy.contains('p.client-fin__err', 'Refund the card payment first'), 5000));
    line('v15-18');
    finish();
  });
});

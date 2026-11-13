/// <reference types="cypress" />
/**
 * Training video, INV-18: appointment deposits, asked for by text, then used at checkout
 * (docs/training/scripts/invoicing/INV-18-appointment-deposits.md). TEST stack, demo names only: Tom Chen and
 * Biscuit, signed in as the client liaison (Casey Morgan). Tom is marked "Deposit required" (INV-19); Biscuit has a
 * wellness visit on the next weekday with an Office exam ($75) and a DHPP vaccine ($32). Texts are captured, not sent.
 * The client's own payment happens off camera (a $100 card payment recorded on the deposit bill).
 */
import '../support/e2e';
import { schedulingApi, schedulingWorld, signInAsScheduling } from '../support/schedulingWorld';
import { catalogId, resetInvoicingWorld, setBillBranch, testDb } from './invKit';
import { bookBiscuit, flagChen, nextWeekdayTen, resetChenDeposits, ymdNy } from './depKit';
import { finish, line, loadNarration, offCamera, pointAt, pointAtInPlace, startClock, tap } from './trainingKit';

describe('Training: INV-18 appointment deposits', () => {
  it('INV-18', () => {
    const w = schedulingWorld();
    const client = w.households.B.clientId;
    const biscuit = w.households.B.petId;
    const pid = w.practiceId;
    loadNarration();
    cy.exec(`psql -q -d ${testDb()} -f cypress/training/setup/invoicing-demo.sql`, { log: false });
    resetInvoicingWorld();
    resetChenDeposits();
    flagChen();
    const day = nextWeekdayTen();
    let appt = 0;
    let depositId = '';
    bookBiscuit(day).then((id) => {
      appt = id;
      schedulingApi<{ id: number }>('doctorA', 'POST', '/soap-encounters', {
        practiceId: pid, appointmentId: id, patientId: biscuit, clientId: client, mode: 'comprehensive',
      }).then((enc) => {
        schedulingApi('cl', 'POST', '/visit-invoices', { practiceId: pid, appointmentId: id, clientId: client }).then(() => {
          setBillBranch(client);
          const order = (name: string, unitPrice: number) =>
            catalogId(name).then((c) =>
              schedulingApi('doctorA', 'POST', `/soap-encounters/${enc.body.id}/orders`, {
                practiceId: pid, name, catalogItemId: c.id, catalogItemType: c.type, qty: 1, kind: 'treatment', state: 'accepted', unitPrice,
              })
            );
          order('Office exam', 75);
          order('DHPP vaccine', 32);
        });
      });
    });
    cy.then(() => signInAsScheduling('cl', `/schedule/scheduler?fromMyDay=1&date=${ymdNy(day)}&provider=${w.doctors.A}`));
    cy.contains('button', /^Day$/, { timeout: 60000 }).click();
    cy.wait(2500);
    const visit = () => cy.get(`[data-appt-id="${appt}"]`).first();
    cy.then(() => visit().should(($el) => $el[0].scrollIntoView({ block: 'center' })));
    cy.wait(1500);

    const modal = () => cy.get('[data-testid="appointment-deposit-modal"]');
    startClock();
    line('inv18-01');
    line('inv18-02', () => {
      cy.then(() => pointAt(visit, 1200));
      cy.then(() => visit().trigger('mouseover', { scrollBehavior: false }).trigger('mousemove', { scrollBehavior: false }));
      cy.get('.scheduler-tooltip-vh-alerts', { timeout: 15000 }).should('contain', 'DEPOSIT REQUIRED');
    });
    line('inv18-03', () => pointAtInPlace(() => cy.get('.scheduler-tooltip-vh-alerts'), 4500));
    line('inv18-04');
    line('inv18-05', () => {
      cy.then(() => pointAt(visit, 1200));
      cy.task('trainingClick', null, { log: false });
      cy.then(() => visit().rightclick());
      cy.wait(400);
    });
    line('inv18-06', () => {
      pointAt(() => cy.contains('.scheduler-ctx-parent-wrap', /^Client/), 1500);
      cy.contains('.scheduler-ctx-parent-wrap', /^Client/).trigger('mouseover');
      cy.wait(300);
    });
    line('inv18-07', () => {
      tap(() => cy.contains('.scheduler-ctx-subitem', 'Appointment Deposit'));
      modal().should('contain', "Deposit for Biscuit's visit");
    });
    line('inv18-08', () => pointAt(() => cy.get('[data-testid="appointment-deposit-amount"]'), 3500));
    line('inv18-09', () => pointAt(() => modal().find('.appointment-deposit__hint'), 5000));
    line('inv18-10', () => {
      tap(() => modal().contains('button', 'Text pay link'));
      cy.get('[role="dialog"] textarea', { timeout: 30000 }).invoke('val').should('match', /http/);
    });
    line('inv18-11', () => pointAt(() => cy.get('[role="dialog"] textarea'), 4500));
    line('inv18-12', () => tap(() => cy.contains('[role="dialog"] button', 'Send message')));
    offCamera(() => modal().contains('Deposit pay link texted to the client.', { timeout: 30000 }).should('exist'));
    line('inv18-13', () => pointAt(() => cy.get('[data-testid="appointment-deposit-status"]'), 4500));
    line('inv18-14', () => pointAt(() => modal().contains('button', 'Email pay link'), 2500));
    line('inv18-15', () => pointAt(() => modal().contains('button', 'Take payment now'), 2500));
    // Off camera: Tom pays the link (recorded as his $100 card payment on the deposit bill).
    offCamera(() => {
      cy.then(() =>
        schedulingApi<{ invoiceId: string }>('cl', 'GET', `/appointment-deposits/${appt}`).then((res) => {
          depositId = res.body.invoiceId;
          schedulingApi('cl', 'POST', `/visit-invoices/${depositId}/tenders`, {
            practiceId: pid, method: 'card', amount: 100, paymentTypeName: 'Card', stripePaymentIntentId: `pi_training_deposit_${Date.now()}`,
          });
        })
      );
      cy.then(() => cy.visit(`/schedule/clients?clientId=${client}&tab=financial&invoice=${depositId}`));
      cy.get('[data-testid="deposit-bill-note"]', { timeout: 60000 }).should('contain', '$100.00 paid');
      cy.wait(1500);
    });
    line('inv18-16', () => pointAt(() => cy.get('[data-testid="deposit-bill-note"]'), 6000));
    line('inv18-17');
    // Visit day: Biscuit's checkout.
    offCamera(() => {
      cy.then(() => cy.visit(`/schedule/soap/${appt}/${biscuit}/checkout?clientId=${client}`));
      cy.contains('.soap-invoice-row.total', '$107.00', { timeout: 60000 }).should('exist');
      cy.contains('.soap-checkout-actions button', 'Account credit', { timeout: 60000 }).should('not.be.disabled');
      cy.wait(1500);
    });
    line('inv18-18', () => tap(() => cy.contains('.soap-checkout-actions button', 'Account credit')));
    line('inv18-19', () => pointAt(() => cy.get('.account-credit-tender'), 6000));
    line('inv18-20', () => tap(() => cy.contains('.account-credit-tender button', 'Apply credit')));
    line('inv18-21', () => pointAt(() => cy.contains(/Used \$100\.00 of account credit/), 4500));
    line('inv18-22');
    line('inv18-23');
    line('inv18-24');
    finish();
  });
});

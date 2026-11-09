/// <reference types="cypress" />
/**
 * Training video OSV-05: send an item by mail from the visit checkout. TEST stack.
 * Setup: a visit today for Juniper (Dr. Avery Lane) with a SOAP encounter. Dr. Lane adds the heartworm chewable at
 * Checkout, writes and approves the script, then chooses Mail order and ships it.
 */
import '../support/e2e';
import { schedulingApi } from '../support/schedulingWorld';
import { look, osv, press, resetStoreData, schedulingWorld, signIn, sql } from './osvTraining';
import { choose, finish, line, loadNarration, pointAt, startClock, tap, typeSlowly } from './trainingKit';

describe('Training: OSV-05 mail an item from the visit', () => {
  it('OSV-05', () => {
    const w = schedulingWorld();
    const o = osv();
    loadNarration();
    resetStoreData();
    // A fresh visit each take: earlier takes' visits for Juniper today are removed.
    sql(`UPDATE appointments SET "isDeleted"=true WHERE "patientId"=${o.pets.juniper} AND "appointmentStart" > now() - interval '1 day'`);
    const start = new Date(Math.floor((Date.now() - 45 * 60_000) / (15 * 60_000)) * 15 * 60_000);
    schedulingApi<{ id: number }>('cl', 'POST', '/appointments', {
      practiceId: w.practiceId, primaryProviderId: w.doctors.A, clientId: o.clients.rivera, patientId: o.pets.juniper,
      appointmentTypeId: w.types.medical, appointmentStart: start.toISOString(),
      appointmentEnd: new Date(start.getTime() + 60 * 60_000).toISOString(), description: 'Heartworm refill', bookedViaRouting: true,
    }).then((res) => {
      const apptId = res.body.id;
      schedulingApi('doctorA', 'POST', '/soap-encounters', {
        practiceId: w.practiceId, appointmentId: apptId, patientId: o.pets.juniper, clientId: o.clients.rivera, mode: 'comprehensive',
      });
      signIn('doctorA', `/schedule/soap/${apptId}/${o.pets.juniper}?clientId=${o.clients.rivera}`);
    });
    const charge = () => cy.get('input[placeholder*="add a charge" i], input[placeholder*="Type here" i]', { timeout: 60000 }).first();
    charge();
    cy.wait(3000);
    charge().then(($e) => $e[0].scrollIntoView({ block: 'center' }));
    cy.wait(800);
    startClock();

    line('v01-why');
    line('v02-checkout', () => look(() => cy.contains(/Checkout/).first(), 3000));
    line('v03-remember');
    line('v04-add', () => typeSlowly(charge, 'Heartworm'));
    line('v04b-pick', () => {
      tap(() => cy.contains('.soap-plan-result', /Heartworm & flea chewable, 22-44 lb/, { timeout: 20000 }).first());
    });
    line('v05-needs-sig', () => look(() => cy.contains('.soap-invoice-line', /Enter the directions/i, { timeout: 20000 }).first(), 3500));
    line('v07-sig', () => {
      typeSlowly(() => cy.contains('label.client-fin__sig', 'Directions (sig)').find('textarea'), 'Give one chewable by mouth once a month with food.');
      // Leaving the box saves the directions, and the other fields lock until that save is done.
      cy.contains('label.client-fin__sig', 'Directions (sig)').find('textarea').blur();
      cy.get('label.client-fin__refill input', { timeout: 20000 }).should('not.be.disabled');
      cy.wait(800);
    });
    line('v08-refills', () => typeSlowly(() => cy.get('label.client-fin__refill input', { timeout: 20000 }).first().should('not.be.disabled'), '5'));
    line('v09-chronic', () => choose(() => cy.get('select[aria-label="Acute or chronic prescription"]', { timeout: 20000 }).first().should('not.be.disabled'), 'chronic'));
    line('v10-approve', () => tap(() => cy.contains('button.client-fin__btn-approve', /^Approve$/)));
    line('v10b-open', () => tap(() => cy.get('button.soap-invoice-line-expand[aria-expanded="false"]', { timeout: 20000 }).first()));
    line('v11-mail', () => tap(() => cy.get('.mail-mode__toggle', { timeout: 20000 }).first().contains('button', /^Mail order/)));
    line('v12-ship', () => {
      cy.contains('h3', 'Send to mail queue', { timeout: 15000 });
      choose(() => cy.contains('label', 'Shipping / pick-up type').find('select'), 'ship-499');
    });
    line('v13-pay', () => look(() => cy.contains('.mail-order-prompt__check', 'Take payment now').parent(), 4500));
    line('v14-add', () => tap(() => cy.contains('button', /^Add to mail queue$/)));
    line('v15-tag', () => look(() => cy.get('.mail-mode__stage, .mail-mode', { timeout: 20000 }).first(), 4000));
    line('v16-lot', () => look(() => cy.contains(/the mail team picks the lot/i).first(), 3500));
    line('v17-total', () => look(() => cy.contains(/^Total/).last(), 3000));
    line('v18-mistakes');
    line('v19-remember');
    finish();
  });
});

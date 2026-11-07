/// <reference types="cypress" />
/**
 * Training video, EMR V8: a prescription on the visit's checkout line: directions, acute or chronic, approve,
 * the DYMO label and the Rx history (docs/training/emr-visit-workflow-video-script.md). TEST stack, demo names:
 * Tom Chen's dog Biscuit (the V7 ear visit), Dr. Avery Lane, Mometamax from stack/demo-names.sh.
 */
import '../support/e2e';
import { resetSeededHouseholdsInDb, schedulingApi, schedulingWorld, signInAsScheduling } from '../support/schedulingWorld';
import { choose, finish, line, loadNarration, pointAt, startClock, tap, typeSlowly } from './trainingKit';

describe('Training: EMR V8 prescriptions', () => {
  it('V8', () => {
    const w = schedulingWorld();
    const biscuit = w.households.B.petId;
    const pid = w.practiceId;
    loadNarration();

    // Setup, before the clock.
    resetSeededHouseholdsInDb();
    // Today's sick visit, with the history charted.
    const start = new Date(Math.floor((Date.now() - 60 * 60_000) / (15 * 60_000)) * 15 * 60_000);
    let apptId = 0;
    schedulingApi<{ id: number }>('cl', 'POST', '/appointments', {
      practiceId: pid,
      primaryProviderId: w.doctors.A,
      clientId: w.households.B.clientId,
      patientId: biscuit,
      appointmentTypeId: w.types.medical,
      appointmentStart: start.toISOString(),
      appointmentEnd: new Date(start.getTime() + 60 * 60_000).toISOString(),
      description: 'Head shaking, right ear',
      bookedViaRouting: true,
    }).then((res) => {
      apptId = res.body.id;
      schedulingApi<{ id: string }>('doctorA', 'POST', '/soap-encounters', {
        practiceId: pid, appointmentId: apptId, patientId: biscuit, clientId: w.households.B.clientId, mode: 'comprehensive',
      }).then((enc) =>
        schedulingApi('doctorA', 'PATCH', `/soap-encounters/${enc.body.id}`, {
          practiceId: pid,
          subjective: { history: 'Shaking his head and pawing at the right ear for 3 days.' },
        })
      );
    });
    cy.then(() =>
      signInAsScheduling('doctorA', `/schedule/soap/${apptId}/${biscuit}?clientId=${w.households.B.clientId}`)
    );
    cy.get('input[placeholder^="Type here to add a charge"]', { timeout: 60000 }).should('exist');
    cy.wait(1500);

    const rx = () => cy.get('.soap-checkout-invoice-rx-match').first();
    startClock();
    line('v8-01');
    line('v8-02', () => {
      typeSlowly(() => cy.get('input[placeholder^="Type here to add a charge"]'), 'Momet');
    });
    line('v8-03', () => {
      tap(() => cy.contains('.soap-plan-result-name', 'Mometamax', { timeout: 20000 }).closest('button'));
      cy.get('.soap-checkout-invoice-rx-match', { timeout: 30000 }).should('exist');
    });
    line('v8-04', () => pointAt(() => cy.contains('.soap-invoice-line', 'Approve the sig').contains('Approve the sig'), 3500));
    line('v8-05', () => pointAt(() => rx().find('.client-fin__sig textarea'), 3500));
    line('v8-06', () => {
      typeSlowly(() => rx().find('.client-fin__sig textarea'), ' Recheck in 2 weeks.');
    });
    line('v8-07', () => {
      tap(() => rx().contains('button', 'Save sig'));
      cy.get('.client-fin__sig-entered', { timeout: 30000 }).should('exist');
    });
    line('v8-08', () => pointAt(() => cy.get('.client-fin__sig-entered').first(), 2500));
    line('v8-09', () => {
      typeSlowly(() => rx().find('.client-fin__refill-input'), '0');
    });
    line('v8-10', () => {
      choose(() => rx().find('select[aria-label="Acute or chronic prescription"]'), 'acute');
    });
    line('v8-11', () => pointAt(() => rx().contains('label', /Discard after/i), 3500));
    line('v8-13', () => {
      tap(() => cy.get('button.client-fin__btn-approve').first());
      cy.get('.soap-checkout-invoice-rx-match', { timeout: 30000 }).should('not.exist');
    });
    line('v8-14', () => {
      pointAt(() => cy.contains('.soap-invoice-line', 'Mometamax'), 2200);
      pointAt(() => cy.get('.soap-checkout-goto button'), 2200);
    });
    line('v8-14b', () => {
      tap(() => cy.contains('.soap-invoice-line', 'Mometamax').find('button.soap-invoice-line-expand'));
      cy.contains('.client-fin__entered', /^Approved/, { timeout: 30000 }).should('exist');
      pointAt(() => cy.contains('.client-fin__entered', /^Approved/), 2200);
    });
    line('v8-14c', () => {
      rx().find('.client-fin__refill-input').clear();
      typeSlowly(() => rx().find('.client-fin__refill-input'), '1');
      cy.contains('button', 'Approve changes', { timeout: 10000 }).should('exist');
      pointAt(() => cy.contains('.client-fin__entered', 'Changed after approval'), 2500);
    });
    line('v8-14d', () => {
      tap(() => cy.contains('button', 'Approve changes'));
      cy.contains('button', 'Approve changes').should('not.exist');
    });
    line('v8-14e', () => {
      cy.contains('.soap-invoice-line', 'Mometamax').then(($l) => {
        if (!$l.find('.soap-checkout-invoice-rx-match').length) {
          cy.wrap($l).find('button.soap-invoice-line-expand').click();
        }
      });
      cy.contains('.client-fin__entered', /^Approved/, { timeout: 30000 }).should('exist');
      pointAt(() => cy.contains('.client-fin__entered', /^Approved/), 3000);
    });
    line('v8-15', () => {
      tap(() => cy.get('button.client-fin__dymo').first());
      cy.get('[role="dialog"]', { timeout: 30000 }).contains('Print prescription label').should('exist');
    });
    line('v8-16', () => pointAt(() => cy.get('.soap-rx-label-static'), 5000));
    line('v8-17', () => {
      pointAt(() => cy.get('[role="dialog"]').contains('button', 'Print on DYMO'), 2000);
    });
    line('v8-17b', () => {
      tap(() => cy.get('[role="dialog"]').contains('button', /^\s*Close\s*$/));
      cy.get('.soap-rx-label-static').should('not.exist');
    });
    line('v8-18', () => {
      tap(() => cy.get('.soap-checkout-invoice-rx-match .record-history > button').first());
      cy.get('.record-history-list', { timeout: 30000 }).should('exist');
    });
    line('v8-19', () => pointAt(() => cy.get('.record-history-panel').first(), 5000));
    line('v8-20');
    line('v8-21');
    line('v8-22');
    finish();
  });
});

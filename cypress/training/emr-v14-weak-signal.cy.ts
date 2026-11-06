/// <reference types="cypress" />
/**
 * Training video, EMR V14: charting and paying with weak signal (docs/training/emr-visit-workflow-video-script.md).
 * TEST stack, demo names: Tom Chen's dog Biscuit, Dr. Avery Lane. The signal is "lost" by dropping every API
 * request in the browser and telling the page it is offline; nothing reaches Stripe while offline.
 */
import '../support/e2e';
import { resetSeededHouseholdsInDb, schedulingApi, schedulingWorld, signInAsScheduling } from '../support/schedulingWorld';
import { finish, line, loadNarration, pointAt, startClock, tap, typeSlowly } from './trainingKit';

describe('Training: EMR V14 weak signal', () => {
  it('V14', () => {
    const w = schedulingWorld();
    const biscuit = w.households.B.petId;
    const client = w.households.B.clientId;
    const pid = w.practiceId;
    loadNarration();

    let offline = false;
    cy.intercept({ url: /localhost:3210\// }, (req) => {
      if (offline) req.destroy();
      else req.continue();
    });
    const network = (on: boolean) => {
      cy.then(() => (offline = !on));
      cy.window({ log: false }).then((win) => {
        Object.defineProperty(win.navigator, 'onLine', { configurable: true, get: () => on });
        win.dispatchEvent(new Event(on ? 'online' : 'offline'));
      });
    };

    // Setup, before the clock.
    resetSeededHouseholdsInDb();
    const db = String(Cypress.env('SCH_DB'));
    expect(db, 'CYPRESS_SCH_DB must be a vayd_api_test* database').to.match(/^vayd_api_test[A-Za-z0-9_]*$/);
    const start = new Date(Math.floor((Date.now() - 60 * 60_000) / (15 * 60_000)) * 15 * 60_000);
    let apptId = 0;
    schedulingApi<{ id: number }>('cl', 'POST', '/appointments', {
      practiceId: pid,
      primaryProviderId: w.doctors.A,
      clientId: client,
      patientId: biscuit,
      appointmentTypeId: w.types.recheck,
      appointmentStart: start.toISOString(),
      appointmentEnd: new Date(start.getTime() + 60 * 60_000).toISOString(),
      description: 'Ear recheck',
      bookedViaRouting: true,
    }).then((res) => {
      apptId = res.body.id;
      schedulingApi<{ id: string }>('doctorA', 'POST', '/soap-encounters', {
        practiceId: pid, appointmentId: apptId, patientId: biscuit, clientId: client, mode: 'comprehensive',
      }).then((enc) =>
        schedulingApi('doctorA', 'PATCH', `/soap-encounters/${enc.body.id}`, {
          practiceId: pid,
          subjective: { history: 'Ear recheck. Finished his Mometamax.' },
        })
      );
    });
    cy.then(() => signInAsScheduling('doctorA', `/schedule/soap/${apptId}/${biscuit}?clientId=${client}`));
    cy.get('input[placeholder^="Type here to add a charge"]', { timeout: 60000 }).type('Office exam');
    cy.contains('.soap-plan-result-name', 'Office exam', { timeout: 20000 }).closest('button').click();
    cy.contains('.soap-invoice-line', 'Office exam', { timeout: 30000 }).should('exist');
    // A card on file (a test reference the fake Stripe accepts), so Card on file is offered.
    cy.then(() =>
      cy.exec(
        `psql -q -d ${db} -c "UPDATE visit_invoices SET \\"stripeCustomerId\\"='cus_training_chen', \\"savedPaymentMethodId\\"='pm_card_visa' WHERE \\"appointmentId\\"=${apptId}"`
      )
    );
    cy.reload();
    cy.contains('Ear recheck. Finished his Mometamax.', { timeout: 60000 }).should('exist');
    cy.wait(2000);

    const editor = () => cy.contains('.soap-rich__editor', 'Ear recheck').first();

    startClock();
    line('v14-01');
    line('v14-02', () => {
      pointAt(editor, 2000);
      network(false);
      cy.get('[data-testid="offline-banner"]').should('be.visible');
    });
    line('v14-03', () => pointAt(() => cy.get('[data-testid="offline-banner"]'), 4000));
    line('v14-04', () => typeSlowly(editor, '{moveToEnd} Ears look clean today, no discharge.'));
    line('v14-05', () => {
      cy.contains('Not saved yet', { timeout: 20000 }).should('exist');
      pointAt(() => cy.contains('Not saved yet').first(), 3000);
    });
    line('v14-06', () => {
      network(true);
      cy.get('[data-testid="offline-banner"]').should('not.exist');
      cy.contains('Not saved yet').should('not.exist');
    });
    line('v14-07', () => pointAt(() => cy.contains('.soap-rich__editor', 'no discharge').first(), 3000));
    line('v14-08', () => {
      cy.get('.soap-checkout-goto button', { timeout: 30000 }).should('not.be.disabled');
      tap(() => cy.get('.soap-checkout-goto button'));
      cy.contains('button', 'Card on file', { timeout: 60000 }).should('not.be.disabled');
      // Let the page finish loading (branch and location) before the signal drops.
      cy.contains('option, span, div', 'Car (default)', { timeout: 60000 }).should('exist');
      cy.wait(1000);
    });
    line('v14-09', () => {
      network(false);
      cy.get('[data-testid="offline-banner"]').should('be.visible');
      pointAt(() => cy.get('[data-testid="offline-banner"]'), 1200);
    });
    line('v14-10', () => {
      tap(() => cy.contains('button', 'Card on file'));
      cy.contains('Not charged', { timeout: 30000 }).should('exist');
    });
    line('v14-11', () => pointAt(() => cy.contains('Not charged').first(), 4500));
    line('v14-12', () => {
      network(true);
      cy.get('[data-testid="offline-banner"]').should('not.exist');
    });
    line('v14-13', () => pointAt(() => cy.contains(/^open$/i).filter(':visible').first(), 3500));
    line('v14-14');
    finish();
  });
});

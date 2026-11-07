/// <reference types="cypress" />
/**
 * Training video, EMR V11: refills of eVet prescriptions, the eVet vaccine history and the rabies certificate (docs/training/emr-visit-workflow-video-script.md). TEST stack, demo names:
 * Maria Rivera's dog Maple, Dr. Avery Lane; her eVet scripts and rabies dose from setup/emr-v11.sql.
 */
import '../support/e2e';
import { resetSeededHouseholdsInDb, schedulingApi, schedulingWorld, signInAsScheduling } from '../support/schedulingWorld';
import { choose, finish, line, loadNarration, pointAt, startClock, tap, typeSlowly } from './trainingKit';

describe('Training: EMR V11 refills', () => {
  it('V11', () => {
    const w = schedulingWorld();
    const maple = w.households.A.activePetIds[0];
    const client = w.households.A.clientId;
    const pid = w.practiceId;
    loadNarration();

    // Setup, before the clock.
    resetSeededHouseholdsInDb();
    const db = String(Cypress.env('SCH_DB'));
    expect(db, 'CYPRESS_SCH_DB must be a vayd_api_test* database').to.match(/^vayd_api_test[A-Za-z0-9_]*$/);
    cy.exec(`psql -q -d ${db} -v pet=${maple} -v vet=${w.doctors.A} -f cypress/training/setup/emr-v11.sql`);
    // Today's sick visit, with the history charted.
    const start = new Date(Math.floor((Date.now() - 60 * 60_000) / (15 * 60_000)) * 15 * 60_000);
    let apptId = 0;
    schedulingApi<{ id: number }>('cl', 'POST', '/appointments', {
      practiceId: pid,
      primaryProviderId: w.doctors.A,
      clientId: client,
      patientId: maple,
      appointmentTypeId: w.types.recheck,
      appointmentStart: start.toISOString(),
      appointmentEnd: new Date(start.getTime() + 60 * 60_000).toISOString(),
      description: 'Recheck, and refill her Carprofen',
      bookedViaRouting: true,
    }).then((res) => {
      apptId = res.body.id;
      schedulingApi<{ id: string }>('doctorA', 'POST', '/soap-encounters', {
        practiceId: pid, appointmentId: apptId, patientId: maple, clientId: client, mode: 'comprehensive',
      }).then((enc) =>
        schedulingApi('doctorA', 'PATCH', `/soap-encounters/${enc.body.id}`, {
          practiceId: pid,
          subjective: { history: 'Doing well on Carprofen. Owner would like a refill.' },
        })
      );
    });
    cy.then(() =>
      signInAsScheduling('doctorA', `/schedule/soap/${apptId}/${maple}?clientId=${client}`)
    );
    // The recheck exam is charged before the clock, so the visit's invoice exists before Refills opens.
    cy.get('input[placeholder^="Type here to add a charge"]', { timeout: 60000 }).type('Office exam');
    cy.contains('.soap-plan-result-name', 'Office exam', { timeout: 20000 }).closest('button').click();
    cy.contains('.soap-invoice-line', 'Office exam', { timeout: 30000 }).should('exist');
    cy.wait(1500);

    // Dr. Lane's signature for the rabies certificate: drawn in the browser, uploaded as the manager.
    cy.window().then((win) => {
      const canvas = win.document.createElement('canvas');
      canvas.width = 520;
      canvas.height = 140;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#1e3a8a';
      ctx.font = "64px 'Snell Roundhand', 'Brush Script MT', cursive";
      ctx.fillText('Avery Lane', 24, 92);
      schedulingApi('manager', 'PUT', `/employees/${w.doctors.A}/signature`, {
        practiceId: pid,
        image: canvas.toDataURL('image/png'),
      });
    });
    const refillLine = () => cy.contains('.soap-invoice-line', 'Carprofen', { timeout: 30000 });
    startClock();
    line('v11-01');
    line('v11-02', () => {
      tap(() => cy.contains('button', /^Refills$/));
      cy.contains('.inv-refill__row', 'Carprofen', { timeout: 30000 }).should('exist');
    });
    line('v11-03', () => {
      pointAt(() => cy.contains('.inv-refill__row', 'Rx #971204').find('.inv-refill__meta'), 2500);
      pointAt(() => cy.contains('.inv-refill__row', 'Rx #971204').find('.inv-refill__sig'), 2500);
    });
    line('v11-04', () => pointAt(() => cy.contains('.inv-refill__row', 'Apoquel'), 3500));
    line('v11-05', () => {
      tap(() => cy.contains('.inv-refill__row', 'Rx #971204').contains('button', 'Use this refill'));
      cy.get('.inv-refill__list').should('not.exist');
      refillLine().should('exist');
    });
    line('v11-06', () => {
      tap(() => refillLine().find('button.soap-invoice-line-expand'));
      cy.get('.inv-refill__summary', { timeout: 30000 }).should('exist');
    });
    line('v11-07', () => {
      pointAt(() => cy.get('.inv-refill__summary strong'), 1800);
      pointAt(() => cy.get('.inv-refill__summary > span').first(), 2200);
    });
    line('v11-07b', () => {
      pointAt(() => cy.get('.inv-refill__directions-text'), 3000);
      pointAt(() => cy.get('.inv-refill__locked'), 2000);
    });
    line('v11-08', () => {
      tap(() => cy.contains('.inv-refill__summary button', 'New directions'));
      cy.contains('[role="dialog"] h3', 'New directions?').should('exist');
    });
    line('v11-09', () => pointAt(() => cy.contains('[role="dialog"] p', 'go to 0'), 4000));
    line('v11-09b', () => pointAt(() => cy.contains('[role="dialog"] p', 'new script for the visit'), 3500));
    line('v11-09c', () => {
      tap(() => cy.contains('[role="dialog"] button', 'Stop refills and write a new script'));
      cy.contains('[role="dialog"] h3', 'New directions?').should('not.exist');
      cy.contains('.client-fin__sig-label', 'Directions (sig)', { timeout: 30000 }).should('exist');
    });
    const rxForm = () => cy.get('.soap-checkout-invoice-rx-match').first();
    line('v11-09d', () => pointAt(() => rxForm().find('.client-fin__sig textarea'), 5000));
    line('v11-09e', () => {
      rxForm().find('.client-fin__refill-input').clear();
      typeSlowly(() => rxForm().find('.client-fin__refill-input'), '0');
    });
    line('v11-09f', () => choose(() => rxForm().find('select[aria-label="Acute or chronic prescription"]'), 'acute'));
    line('v11-09g', () => {
      tap(() => cy.get('button.client-fin__btn-approve').first());
      cy.contains('.soap-invoice-line', 'Carprofen').find('.soap-invoice-line-expand').should('exist');
      cy.contains('.soap-invoice-line', 'Approve the sig').should('not.exist');
    });
    line('v11-10', () => {
      tap(() => cy.contains('a, button', /^View details$/).first());
      cy.contains('Rabies', { timeout: 60000 }).should('exist');
    });
    // The row on screen (the page behind the medical record has its own, hidden copy).
    const onScreenRow = () =>
      cy.get('tr:contains("Rabies 3yr Vaccine")').filter((_, el) => {
        const r = el.getBoundingClientRect();
        return r.height > 0 && r.top >= 0 && r.bottom <= el.ownerDocument.defaultView!.innerHeight;
      }).first();
    line('v11-11', () => {
      cy.get('tr:contains("Rabies 3yr Vaccine")').last().scrollIntoView({ block: 'center' } as never);
      pointAt(onScreenRow, 3500);
    });
    line('v11-12', () => {
      tap(() => cy.contains('button', 'Print document').first());
    });
    line('v11-13', () => {
      tap(() => cy.contains('Rabies certificate').first());
      cy.wait(2500);
    });
    line('v11-14', () => {
      cy.contains('Signature on file', { timeout: 30000 }).should('exist');
      pointAt(() => cy.contains('.chart-print-doc__fact', /^License/), 3500);
    });
    line('v11-14b', () => pointAt(() => cy.contains('Signature on file').parent().find('img'), 2500));
    line('v11-15');
    line('v11-16');
    finish();
  });
});

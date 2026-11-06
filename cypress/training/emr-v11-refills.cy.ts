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

    const refillLine = () => cy.contains('.soap-invoice-line', 'Carprofen', { timeout: 30000 });
    startClock();
    line('v11-01');
    line('v11-02', () => {
      tap(() => cy.contains('button', /^Refills$/));
      cy.contains('.inv-refill__row', 'Carprofen', { timeout: 30000 }).should('exist');
    });
    line('v11-03', () => {
      pointAt(() => cy.contains('.inv-refill__row', 'Carprofen').find('.inv-refill__meta'), 2500);
      pointAt(() => cy.contains('.inv-refill__row', 'Carprofen').find('.inv-refill__sig'), 2500);
    });
    line('v11-04', () => pointAt(() => cy.contains('.inv-refill__row', 'Apoquel'), 3500));
    line('v11-05', () => {
      tap(() => cy.contains('.inv-refill__row', 'Carprofen').contains('button', 'Use this refill'));
      cy.get('.inv-refill__list').should('not.exist');
      refillLine().should('exist');
    });
    line('v11-06', () => {
      tap(() => refillLine().find('button.soap-invoice-line-expand'));
      cy.get('.inv-refill__summary', { timeout: 30000 }).should('exist');
    });
    line('v11-07', () => {
      pointAt(() => cy.get('.inv-refill__summary strong'), 2500);
      pointAt(() => cy.get('.inv-refill__locked'), 2500);
    });
    line('v11-10', () => {
      tap(() => cy.contains('a, button', /^View details$/).first());
      cy.contains('Rabies', { timeout: 60000 }).should('exist');
    });
    line('v11-11', () => pointAt(() => cy.contains('tr', /Rabies/).first(), 3500));
    line('v11-12', () => {
      tap(() => cy.contains('button', 'Print document').first());
    });
    line('v11-13', () => {
      tap(() => cy.contains('Rabies certificate').first());
      cy.wait(2500);
    });
    line('v11-14', () => pointAt(() => cy.get('select').filter(':contains("NC-VET-00417")').first(), 4000));
    line('v11-15');
    line('v11-16');
    finish();
  });
});

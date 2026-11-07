/// <reference types="cypress" />
/**
 * Training video, EMR V16: changing refills on the chart (owner decisions Nov 6, 2026). TEST stack, demo names:
 * Maria Rivera's dog Maple and her eVet Carprofen (2 refills left), Dr. Avery Lane (setup/emr-v11.sql).
 */
import '../support/e2e';
import { resetSeededHouseholdsInDb, schedulingWorld, signInAsScheduling } from '../support/schedulingWorld';
import { finish, line, loadNarration, pointAt, startClock, tap, typeSlowly } from './trainingKit';

describe('Training: EMR V16 refill controls', () => {
  it('V16', () => {
    const w = schedulingWorld();
    const maple = w.households.A.activePetIds[0];
    loadNarration();
    resetSeededHouseholdsInDb();
    const db = String(Cypress.env('SCH_DB'));
    expect(db, 'CYPRESS_SCH_DB must be a vayd_api_test* database').to.match(/^vayd_api_test[A-Za-z0-9_]*$/);
    cy.exec(`psql -q -d ${db} -v pet=${maple} -v vet=${w.doctors.A} -f cypress/training/setup/emr-v11.sql`);
    // The staff History starts empty for this take.
    cy.exec(`psql -q -d ${db} -c "DELETE FROM clinical_record_events WHERE \\"patientId\\"=${maple} AND kind IN ('refills_changed','refills_stopped')"`);
    signInAsScheduling('doctorA', `/schedule/patients?patientId=${maple}`);
    cy.contains('.pims-patient-detail__tab', /^Rx \(/, { timeout: 60000 }).should('exist');
    cy.wait(2000);

    const carprofenRow = () => cy.contains('tr.pims-patient-detail__mr-row--clickable', 'Carprofen');
    const controls = () => cy.get('.rx-refill-controls').first();
    startClock();
    line('v16-01');
    line('v16-02', () => {
      tap(() => cy.contains('.pims-patient-detail__tab', /^Rx \(/));
      carprofenRow().should('exist');
    });
    line('v16-03', () => pointAt(() => cy.contains('.pims-patient-detail__rx-group', 'Carprofen'), 3500));
    line('v16-04', () => {
      tap(carprofenRow);
      controls().should('exist');
    });
    line('v16-05', () => {
      pointAt(() => cy.get('.pims-patient-detail__expand-row .pims-patient-detail__expand-text').first(), 2200);
      pointAt(() => controls().find('input[type="number"]'), 2200);
    });
    line('v16-06', () => {
      controls().find('input[type="number"]').clear();
      typeSlowly(() => controls().find('input[type="number"]'), '1');
    });
    line('v16-07', () => {
      tap(() => controls().contains('button', 'Save refills'));
      controls().contains('Saved: 1 refill left', { timeout: 30000 }).should('exist');
    });
    line('v16-08', () => {
      tap(() => controls().contains('button', 'Stop refills'));
      controls().contains('Refills stopped', { timeout: 30000 }).should('exist');
    });
    line('v16-09', () => pointAt(() => controls().find('input[type="number"]'), 3000));
    line('v16-10', () => pointAt(() => controls().contains('button', 'New directions'), 6000));
    line('v16-11', () => {
      tap(() => cy.contains('.pims-patient-detail__tab', /^History$/));
      cy.contains('Refills stopped by', { timeout: 30000 }).should('exist');
    });
    line('v16-12', () => pointAt(() => cy.contains('Refills stopped by').filter(':visible').first(), 3500));
    line('v16-13');
    line('v16-14');
    finish();
  });
});

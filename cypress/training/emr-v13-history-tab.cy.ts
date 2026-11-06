/// <reference types="cypress" />
/**
 * Training video, EMR V13: the pet's staff-only History tab (docs/training/emr-visit-workflow-video-script.md).
 * TEST stack, demo names: Maria Rivera's dog Maple, Dr. Avery Lane and Jordan Pike (tech). The logged steps come
 * from setup/emr-v13.sql.
 */
import '../support/e2e';
import { schedulingWorld, signInAsScheduling } from '../support/schedulingWorld';
import { finish, line, loadNarration, pointAt, startClock, tap } from './trainingKit';

describe('Training: EMR V13 History tab', () => {
  it('V13', () => {
    const w = schedulingWorld();
    const maple = w.households.A.activePetIds[0];
    loadNarration();

    const db = String(Cypress.env('SCH_DB'));
    expect(db, 'CYPRESS_SCH_DB must be a vayd_api_test* database').to.match(/^vayd_api_test[A-Za-z0-9_]*$/);
    cy.exec(
      `psql -q -d ${db} -v pet=${maple} -v vet=${w.doctors.A} -v tech=${w.employees.technician} -f cypress/training/setup/emr-v13.sql`
    );
    signInAsScheduling('doctorA', `/schedule/patients?patientId=${maple}`);
    cy.contains('h2', 'Timeline', { timeout: 60000 }).should('exist');
    cy.wait(2000);

    const row = (text: string | RegExp) => cy.contains('.patient-record-history__table tbody tr', text);

    startClock();
    line('v13-01');
    line('v13-02', () => pointAt(() => cy.contains('h2', 'Timeline'), 2500));
    line('v13-03', () => {
      tap(() => cy.contains('.pims-patient-detail__tab', /^History$/));
      cy.get('.patient-record-history__table', { timeout: 30000 }).should('exist');
    });
    line('v13-04', () => pointAt(() => cy.get('.patient-record-history__note'), 3500));
    line('v13-05', () => pointAt(() => cy.get('.patient-record-history__table thead'), 3000));
    line('v13-06', () => {
      pointAt(() => row('Result entered'), 2500);
      pointAt(() => row('Result completed'), 2500);
    });
    line('v13-07', () => pointAt(() => row('Dose changed'), 4500));
    line('v13-08', () => {
      pointAt(() => row('Directions entered'), 2500);
      pointAt(() => row('Approved for dispensing'), 1800);
      pointAt(() => row('Label printed'), 1800);
    });
    line('v13-09');
    line('v13-10');
    finish();
  });
});

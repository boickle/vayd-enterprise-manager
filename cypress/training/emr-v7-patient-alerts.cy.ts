/// <reference types="cypress" />
/**
 * Training video EMR V7 (re-recorded, alerts only; the lab half is LV-01 and LV-02). TEST stack, demo names:
 * Tom Chen's dog Biscuit, Dr. Avery Lane, Jordan Pike (tech) who wrote the alert.
 */
import '../support/e2e';
import { schedulingWorld, signInAsScheduling } from '../support/schedulingWorld';
import { finish, line, loadNarration, offCamera, pointAt, startClock, tap, typeSlowly } from './trainingKit';
import { labsApi, labsSetup, soapPath, visitToday } from './labsTraining';

describe('Training: EMR V7 patient alerts', () => {
  it('V7 alerts', () => {
    const w = schedulingWorld();
    const biscuit = w.households.B.petId;
    loadNarration();
    labsSetup([biscuit]);
    labsApi('technician', 'PATCH', `/patients/${biscuit}`, { alerts: 'Bites when his ears are handled. Muzzle for ear exams.' });
    visitToday({ household: 'B', petId: biscuit, reason: 'Shaking his head, right ear.', startsMinutesAgo: 30 }).then((v) =>
      signInAsScheduling('doctorA', soapPath(v.apptId, biscuit, v.clientId))
    );
    cy.get('[data-testid="soap-patient-alerts"]', { timeout: 120000 }).should('be.visible');
    cy.wait(2000);
    const alertBox = () => cy.contains('.pims-emr-alert-box', 'Patient alerts', { timeout: 60000 });

    startClock();
    line('a7-01');
    line('a7-02');
    line('a7-03', () => pointAt(() => cy.get('[data-testid="soap-patient-alerts"]'), 3000));
    line('a7-04', () => pointAt(() => cy.get('[data-testid="soap-patient-alerts"]').contains(/Jordan|Pike/).first(), 2500));
    line('a7-05');
    offCamera(() => {
      cy.visit(`/schedule/patients?patientId=${biscuit}`);
      alertBox().should('exist');
      cy.wait(1000);
    });
    line('a7-06', () => {
      tap(() => alertBox().find('button').first());
      cy.get('textarea').filter(':visible').first().should('exist');
    });
    line('a7-07', () => typeSlowly(() => cy.get('textarea').filter(':visible').first(), '{moveToEnd} Prefers the exam in the car.'));
    line('a7-08', () => {
      tap(() => cy.contains('button', /^Save/).filter(':visible').first());
      alertBox().should('contain.text', 'Prefers the exam in the car');
    });
    line('a7-09', () => pointAt(alertBox, 3500));
    line('a7-10');
    finish();
  });
});

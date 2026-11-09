/// <reference types="cypress" />
/**
 * Training video LV-12: lab history on the chart, including eVet (docs/training/scripts/labs/LV-12-lab-history-on-the-chart.md).
 * TEST stack: Maple's eVet 4Dx from last year (setup/labs-demo.sql, with eVet's names loaded as in LAB-10) and
 * today's blood glucose. Demo names: Maria Rivera's dog Maple, Dr. Avery Lane.
 */
import '../support/e2e';
import { schedulingWorld, signInAsScheduling } from '../support/schedulingWorld';
import { finish, line, loadNarration, pointAt, startClock, tap } from './trainingKit';
import { asList, labId, labsApi, labsSetup, visitToday } from './labsTraining';

describe('Training: LV-12 lab history', () => {
  it('LV-12', () => {
    const w = schedulingWorld();
    const pid = w.practiceId;
    const maple = w.households.A.activePetIds[0];
    loadNarration();
    labsSetup([maple]);
    labId('glucose').then((glucose) =>
      visitToday({ household: 'A', petId: maple, reason: 'Drinking more.', startsMinutesAgo: 60 }).then((v) => {
        labsApi('doctorA', 'POST', `/soap-encounters/${v.encounterId}/orders`, {
          practiceId: pid, name: 'Blood glucose (in-house)', kind: 'treatment', catalogItemType: 'lab', catalogItemId: glucose, qty: 1, unitPrice: 25, state: 'accepted',
        });
        labsApi('doctorA', 'GET', `/visit-invoices/by-appointment/${v.apptId}?practiceId=${pid}`).then(() =>
          labsApi('technician', 'GET', `/in-house-labs/results?practiceId=${pid}&patientId=${maple}`).then((res) => {
            const pending = asList(res.body).find((r) => r.status === 'pending');
            labsApi('technician', 'PATCH', `/in-house-labs/results/${pending.id}?practiceId=${pid}`, {
              values: { 'blood-glucose': { value: '312', comments: null } },
            });
          })
        );
      })
    );
    signInAsScheduling('doctorA', `/schedule/patients?patientId=${maple}`);
    cy.contains('h2', 'Timeline', { timeout: 120000 }).should('exist');
    cy.wait(2000);
    const evetRow = () => cy.get('[data-chart-row-id^="evetInHouseLab:"]', { timeout: 30000 }).first();

    startClock();
    line('lv12-01');
    line('lv12-02');
    line('lv12-03', () => pointAt(() => cy.contains('h2', 'Timeline'), 3000));
    line('lv12-04', () => {
      tap(() => cy.contains('button', 'All dates'));
      evetRow().should('exist');
    });
    line('lv12-05', () => {
      pointAt(() => cy.contains('.pims-patient-detail__mr-table tbody tr', /Blood glucose/).first(), 2000);
      pointAt(evetRow, 2200);
    });
    line('lv12-06', () => {
      tap(() => cy.contains('[role="tab"]', /^Labs \(/));
      evetRow().should('exist');
    });
    line('lv12-07', () => {
      tap(evetRow);
      cy.contains('Anaplasma: POSITIVE', { timeout: 30000 }).should('exist');
    });
    line('lv12-08', () => pointAt(() => cy.contains('Anaplasma: POSITIVE'), 3500));
    line('lv12-09', () => pointAt(() => cy.get('[aria-label="Print all records"]'), 3000));
    line('lv12-10');
    finish();
  });
});

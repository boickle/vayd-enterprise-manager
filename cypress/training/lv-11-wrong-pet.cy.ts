/// <reference types="cypress" />
/**
 * Training video LV-11: a lab charged to the wrong pet (docs/training/scripts/labs/LV-11-wrong-pet-or-removed-charge.md).
 * TEST stack. Maple's bill has a blood glucose with its result (312) entered; it was Pepper's. Demo names: Maria
 * Rivera's dogs Maple and Pepper, Jordan Pike (tech).
 */
import '../support/e2e';
import { schedulingWorld, signInAsScheduling } from '../support/schedulingWorld';
import { choose, finish, line, loadNarration, offCamera, pointAt, startClock, tap } from './trainingKit';
import { asList, labId, labsApi, labsSetup, visitToday } from './labsTraining';

describe('Training: LV-11 wrong pet', () => {
  it('LV-11', () => {
    const w = schedulingWorld();
    const pid = w.practiceId;
    const maple = w.households.A.activePetIds[0];
    const pepper = w.households.A.inactivePetId;
    const client = w.households.A.clientId;
    loadNarration();
    labsSetup([maple, pepper]);
    let billId = '';
    labId('glucose').then((glucose) =>
      visitToday({ household: 'A', petId: maple, reason: 'Drinking more.', startsMinutesAgo: 60 }).then((v) => {
        labsApi('doctorA', 'POST', `/soap-encounters/${v.encounterId}/orders`, {
          practiceId: pid, name: 'Blood glucose (in-house)', kind: 'treatment', catalogItemType: 'lab', catalogItemId: glucose, qty: 1, unitPrice: 25, state: 'accepted',
        });
        labsApi<{ id: string }>('doctorA', 'GET', `/visit-invoices/by-appointment/${v.apptId}?practiceId=${pid}`).then((bill) => {
          billId = bill.body.id;
          labsApi('technician', 'GET', `/in-house-labs/results?practiceId=${pid}&patientId=${maple}`).then((res) => {
            const pending = asList(res.body).find((r) => r.status === 'pending');
            labsApi('technician', 'PATCH', `/in-house-labs/results/${pending.id}?practiceId=${pid}`, {
              values: { 'blood-glucose': { value: '312', comments: null } },
            });
          });
        });
      })
    );
    cy.then(() => signInAsScheduling('technician', `/schedule/clients?clientId=${client}&tab=financial&invoice=${billId}`));
    const glucoseRow = () => cy.contains('tr', 'Blood glucose (in-house)', { timeout: 120000 }).first();
    glucoseRow().should('exist');
    cy.wait(2000);
    const move = () => cy.get('select[aria-label="Move to another pet"]').first();
    const confirm = () => cy.get('.app-dialog[role="dialog"]');
    const chartLab = () => cy.contains('.pims-patient-detail__mr-table tbody tr', /Blood glucose|BLOOD GLUCOSE/, { timeout: 60000 });
    const openChart = (petId: number, tabName: RegExp) =>
      offCamera(() => {
        cy.visit(`/schedule/patients?patientId=${petId}`);
        cy.contains('[role="tab"]', tabName, { timeout: 120000 }).click();
        cy.wait(1500);
      });

    startClock();
    line('lv11-01');
    line('lv11-02');
    line('lv11-03', () => pointAt(glucoseRow, 3500));
    line('lv11-04', () => {
      tap(() => glucoseRow().find('button').first());
      move().should('exist');
    });
    line('lv11-05', () => pointAt(() => cy.contains('label', 'Charged to the wrong pet?'), 2500));
    line('lv11-06', () => {
      choose(move, 'Pepper');
      confirm().should('be.visible');
    });
    line('lv11-07', () => pointAt(() => confirm().find('.app-dialog__body'), 3500));
    line('lv11-08', () => {
      tap(() => confirm().contains('button', 'Move to Pepper'));
      confirm().should('not.exist');
    });
    openChart(pepper, /^Labs \(/);
    line('lv11-09', () => pointAt(chartLab, 3000));
    openChart(maple, /^Labs \(/);
    line('lv11-10', () => {
      cy.contains('.pims-patient-detail__mr-table tbody tr', /Blood glucose|BLOOD GLUCOSE/).should('not.exist');
      pointAt(() => cy.get('.pims-patient-detail__mr-table').first(), 3000);
    });
    openChart(pepper, /^History$/);
    line('lv11-11', () => pointAt(() => cy.contains('tr', /moved|Moved/).first(), 3000));
    line('lv11-12');
    line('lv11-13');
    finish();
  });
});

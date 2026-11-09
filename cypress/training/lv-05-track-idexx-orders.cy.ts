/// <reference types="cypress" />
/**
 * Training video LV-05: track and cancel IDEXX orders (docs/training/scripts/labs/LV-05-track-and-cancel-idexx-orders.md).
 * TEST stack with IDEXX's sandbox practice. Pepper's CBC is sent in the setup and never finished in IDEXX; Juniper's
 * earlier orders are at IDEXX. Demo names: the Riveras, Dr. Avery Lane, Jordan Pike (tech).
 */
import '../support/e2e';
import { schedulingWorld, signInAsScheduling } from '../support/schedulingWorld';
import { finish, line, loadNarration, pointAt, startClock, tap } from './trainingKit';
import { labId, labsApi, labsDb, labsSetup, visitToday } from './labsTraining';

describe('Training: LV-05 track IDEXX orders', () => {
  it('LV-05', () => {
    const w = schedulingWorld();
    const pid = w.practiceId;
    const pepper = w.households.A.inactivePetId;
    loadNarration();
    labsSetup([pepper]);
    // Earlier takes' unfinished orders for Pepper are cancelled, so only today's shows.
    cy.exec(`psql -q -d ${labsDb()} -c "UPDATE idexx_orders SET status='CANCELLED' WHERE \\"patientId\\"=${pepper} AND status='CREATED'"`);
    cy.exec(`psql -q -d ${labsDb()} -c "UPDATE patients SET dob=COALESCE(dob,'2018-03-01') WHERE id=${pepper}"`);
    labId('cbc').then((cbc) =>
      visitToday({ household: 'A', petId: pepper, reason: 'Recheck bloodwork.', startsMinutesAgo: 90 }).then((v) => {
        labsApi('doctorA', 'POST', `/soap-encounters/${v.encounterId}/orders`, {
          practiceId: pid, name: 'CBC - standard', kind: 'treatment', catalogItemType: 'lab', catalogItemId: cbc, qty: 1, unitPrice: 186.36, state: 'accepted',
        });
        labsApi<{ id: string }>('doctorA', 'GET', `/visit-invoices/by-appointment/${v.apptId}?practiceId=${pid}`).then((bill) =>
          labsApi('technician', 'POST', `/idexx/invoices/${bill.body.id}/orders`, { patientId: pepper })
        );
      })
    );
    signInAsScheduling('technician', '/schedule');
    cy.contains('nav a, header a', /^Labs$/, { timeout: 90000 }).should('exist');
    cy.wait(2000);
    const tab = (name: string) => cy.contains('[role="tab"]', name);
    const pepperRow = () => cy.contains('.idexx-order__result-row', 'Pepper', { timeout: 30000 });
    const confirm = () => cy.get('.app-dialog[role="dialog"]');

    startClock();
    line('lv05-01');
    line('lv05-02');
    line('lv05-03', () => {
      tap(() => cy.contains('nav a, header a', /^Labs$/));
      tab('To review').should('exist');
    });
    line('lv05-04', () => pointAt(() => cy.get('.pending-labs__tabs'), 3000));
    line('lv05-05', () => {
      tap(() => tab('Ordered, not at IDEXX yet'));
      pepperRow().should('exist');
    });
    line('lv05-06', () => pointAt(pepperRow, 3500));
    line('lv05-07', () => {
      tap(() => pepperRow().contains('button', 'Cancel order'));
      confirm().should('be.visible');
    });
    line('lv05-08', () => pointAt(() => confirm().find('.app-dialog__body'), 3500));
    line('lv05-09', () => {
      tap(() => confirm().contains('button', 'Cancel order'));
      cy.contains('.idexx-order__result-row', 'Pepper').should('not.exist');
    });
    line('lv05-10', () => {
      tap(() => tab('In progress at IDEXX'));
      cy.wait(1500);
    });
    line('lv05-11', () => tap(() => cy.contains('button', 'Check IDEXX now')));
    line('lv05-12', () => {
      tap(() => tab('All recent'));
      cy.wait(1500);
    });
    line('lv05-13', () => {
      pointAt(() => tab('To review'), 1800);
      pointAt(() => tab('Unmatched'), 1800);
    });
    line('lv05-14');
    finish();
  });
});

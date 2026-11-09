/// <reference types="cypress" />
/**
 * Training video LV-10: IDEXX lab charges on the bill, for client liaisons
 * (docs/training/scripts/labs/LV-10-idexx-charges-on-the-bill.md). TEST stack; uses Juniper's bill from LV-04
 * (a CBC, plus a urinalysis the doctor added inside IDEXX's sandbox page). The Billing task is made in the setup.
 * Demo names: Maria Rivera's cat Juniper, Casey Morgan (client liaison).
 */
import '../support/e2e';
import { schedulingWorld, signInAsScheduling } from '../support/schedulingWorld';
import { finish, line, loadNarration, offCamera, pointAt, startClock } from './trainingKit';
import { labsApi, labsDb, labsSetup } from './labsTraining';

describe('Training: LV-10 IDEXX charges on the bill', () => {
  it('LV-10', () => {
    const w = schedulingWorld();
    const juniper = w.households.A.activePetIds[1];
    const client = w.households.A.clientId;
    loadNarration();
    labsSetup([juniper]);
    cy.exec(`psql -q -d ${labsDb()} -c "UPDATE tasks SET \\"isDeleted\\"=true WHERE title LIKE 'IDEXX ran %'"`);
    labsApi('manager', 'POST', '/tasks', {
      title: 'IDEXX ran Urinalysis Follow-up, not charged',
      body: "The doctor added Urinalysis Follow-up (9102) in IDEXX for Juniper (Maria Rivera), but the bill was already paid. Add the charge to the family's account.",
      assignedToEmployeeId: w.employees.cl,
    });
    cy.exec(
      `psql -qAt -d ${labsDb()} -c "SELECT l.\\"invoiceId\\" FROM visit_invoice_lines l JOIN encounter_orders o ON o.id::text = l.\\"orderId\\"::text WHERE l.description='Urinalysis' AND l.\\"patientId\\"=${juniper} AND o.\\"autoAddedFor\\"='idexx' AND NOT l.\\"isDeleted\\" ORDER BY l.created DESC LIMIT 1"`
    ).then((r) => {
      const invoiceId = r.stdout.trim();
      expect(invoiceId, "Juniper's bill from LV-04").to.have.length.greaterThan(10);
      signInAsScheduling('cl', `/schedule/clients?clientId=${client}&tab=financial&invoice=${invoiceId}`);
    });
    const lineRow = (text: string) => cy.contains('tr', text, { timeout: 120000 });
    lineRow('CBC - standard').should('exist');
    cy.wait(2000);

    startClock();
    line('lv10-01');
    line('lv10-02');
    line('lv10-03', () => pointAt(() => lineRow('CBC - standard'), 3000));
    line('lv10-04', () => pointAt(() => lineRow('CBC - standard').find('.idexx-chip'), 3500));
    line('lv10-05', () => {
      pointAt(() => lineRow('Urinalysis'), 2000);
      pointAt(() => lineRow('Urinalysis').find('.idexx-added-tag'), 2500);
    });
    line('lv10-06');
    offCamera(() => {
      cy.visit('/schedule/tasks');
      cy.contains('IDEXX ran Urinalysis Follow-up, not charged', { timeout: 120000 }).should('exist');
    });
    line('lv10-07', () => pointAt(() => cy.contains('IDEXX ran Urinalysis Follow-up, not charged').first(), 3500));
    line('lv10-08');
    line('lv10-09');
    finish();
  });
});

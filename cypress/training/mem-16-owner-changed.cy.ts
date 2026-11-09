/// <reference types="cypress" />
/**
 * Training video, MEM-16: pet changed owners (docs/training/scripts/memberships/MEM-16-owner-changed.md).
 * TEST stack on Stripe TEST mode, demo names only. Biscuit (the Chens' dog) is on Canine Foundations billed to Tom
 * Chen. Setup moves Biscuit to Maria Rivera and sets the owner-change flag the nightly check would set (scheduled jobs
 * are off on the test stack). The end puts Biscuit back with the Chens.
 */
import '../support/e2e';
import { signInAsScheduling } from '../support/schedulingWorld';
import { chartUrl, enrolPet, fileAgreement, pets, PLAN, quietChart, resetMembershipWorld, settle, sql, trace } from './memKit';
import { finish, line, loadNarration, offCamera, pointAt, startClock, tap, typeSlowly } from './trainingKit';

describe('Training: MEM-16 owner changed', () => {
  it('MEM-16', () => {
    const p = pets();
    loadNarration();
    trace('setup');
    const backToChens = [
      `DELETE FROM clients_patients_patients WHERE "patientsId"=${p.biscuit}`,
      `INSERT INTO clients_patients_patients ("clientsId","patientsId") VALUES (${p.tom},${p.biscuit})`,
    ];
    resetMembershipWorld(backToChens);
    enrolPet(p.biscuit, PLAN.dogFoundationsMonthly, { startDaysAgo: 120, clientId: p.tom }).then((id) => {
      const detail = JSON.stringify({
        previous: [{ id: p.tom, name: 'Tom Chen' }],
        current: [{ id: p.maria, name: 'Maria Rivera' }],
        payer: { id: p.tom, name: 'Tom Chen' },
      });
      sql(
        [
          `UPDATE clients_patients_patients SET "clientsId"=${p.maria} WHERE "patientsId"=${p.biscuit}`,
          `UPDATE wellness_plans SET "ownerClientIds"='{${p.maria}}', "ownerChangeFlaggedAt"=now() - interval '1 day', "ownerChangeDetail"='${detail}'::jsonb WHERE id=${id}`,
        ].join('; ')
      );
    });
    fileAgreement(p.biscuit, p.tom, 120);
    signInAsScheduling('manager', chartUrl(p.biscuit));
    quietChart();
    cy.get('.pmp-owner-change', { timeout: 60000 }).should('be.visible');
    settle(() => cy.get('.pmp-summary'));
    cy.wait(1000);

    const dialog = () => cy.get('[role="dialog"], [role="alertdialog"]');
    trace('clock');
    startClock();
    trace('m16-01'); line('m16-01');
    trace('m16-02'); line('m16-02');
    trace('m16-03'); line('m16-03', () => pointAt(() => cy.contains('Owner changed').filter(':visible').first(), 3000));
    trace('m16-04'); line('m16-04', () => pointAt(() => cy.get('.pmp-owner-change p'), 7000));
    trace('m16-05'); line('m16-05');
    trace('m16-06'); line('m16-06', () => {
      tap(() => cy.get('.pmp-owner-change').contains('button', 'Mark handled'));
      dialog().should('exist');
    });
    trace('m16-07'); line('m16-07', () => typeSlowly(() => dialog().find('textarea, input').first(), 'Cancelled with Tom; Maria signing Biscuit up fresh'));
    trace('m16-08'); line('m16-08', () => {
      tap(() => dialog().contains('button', 'Mark handled'));
      cy.get('.pmp-owner-change', { timeout: 30000 }).should('not.exist');
      cy.wait(1000);
    });
    trace('m16-09'); line('m16-09');
    trace('done');
    finish();
    offCamera(() => sql(backToChens.join('; ')));
  });
});

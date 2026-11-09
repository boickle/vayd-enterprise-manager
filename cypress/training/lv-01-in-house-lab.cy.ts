/// <reference types="cypress" />
/**
 * Training video LV-01: run an in-house lab in the visit (docs/training/scripts/labs/LV-01-run-an-in-house-lab.md).
 * TEST stack, demo names: Maria Rivera's dog Maple, Dr. Avery Lane, Jordan Pike (tech). Forms from setup/labs-demo.sql.
 */
import '../support/e2e';
import { schedulingWorld, signInAsScheduling } from '../support/schedulingWorld';
import { finish, line, loadNarration, pointAt, startClock, tap, typeSlowly, choose } from './trainingKit';
import { labsSetup, soapPath, visitToday } from './labsTraining';

describe('Training: LV-01 in-house lab', () => {
  it('LV-01', () => {
    const w = schedulingWorld();
    const maple = w.households.A.activePetIds[0];
    loadNarration();
    labsSetup([maple]);
    visitToday({ household: 'A', petId: maple, reason: 'Drinking and urinating more for two weeks.' }).then((v) =>
      signInAsScheduling('technician', soapPath(v.apptId, maple, v.clientId))
    );
    const charge = () => cy.get('input[placeholder^="Type here to add a charge"], input[placeholder="Add a charge for Maple"]').filter(':visible').first();
    cy.get('.soap-checkout-add, input[placeholder^="Type here to add a charge"]', { timeout: 60000 }).should('exist');
    cy.wait(2000);
    const lineFor = (text: string) => cy.contains('[id^="checkout-line-"]', text, { timeout: 30000 });
    const form = (name: string) =>
      cy.get('.soap-invoice-line-drawer.is-open .lab-result-form', { timeout: 30000 }).filter(`:contains("${name}")`).first();

    startClock();
    line('lv01-01');
    line('lv01-02', () => pointAt(() => cy.contains('Drinking and urinating more').first(), 3000));
    line('lv01-03');
    line('lv01-04', () => typeSlowly(charge, 'glucose'));
    line('lv01-05', () => {
      tap(() => cy.contains('.soap-plan-result-name', 'Blood glucose', { timeout: 20000 }).closest('button'));
      lineFor('Blood glucose').find('.lab-chip').should('contain.text', 'Not run');
    });
    line('lv01-06', () => pointAt(() => lineFor('Blood glucose').find('.lab-chip'), 3000));
    line('lv01-07', () => {
      tap(() => lineFor('Blood glucose').find('button.soap-invoice-line-expand'));
      form('BLOOD GLUCOSE').should('exist');
    });
    line('lv01-08', () => pointAt(() => form('BLOOD GLUCOSE').find('input[aria-label="BLOOD GLUCOSE value"]'), 3000));
    line('lv01-09', () => typeSlowly(() => form('BLOOD GLUCOSE').find('input[aria-label="BLOOD GLUCOSE value"]'), '312'));
    line('lv01-10', () => {
      tap(() => form('BLOOD GLUCOSE').contains('button', 'Save results'));
      lineFor('Blood glucose').find('.lab-chip', { timeout: 30000 }).should('contain.text', 'Complete');
    });
    line('lv01-11', () => pointAt(() => lineFor('Blood glucose').find('.lab-chip'), 3500));
    line('lv01-12', () => typeSlowly(charge, '4dx'));
    line('lv01-12b', () => {
      tap(() => cy.contains('.soap-plan-result-name', 'Heartworm 4Dx', { timeout: 20000 }).closest('button'));
      lineFor('Heartworm 4Dx').find('.lab-chip').should('contain.text', 'Not run');
    });
    line('lv01-13', () => {
      tap(() => lineFor('Heartworm 4Dx').find('button.soap-invoice-line-expand'));
      form('Heartworm 4dx').should('exist');
    });
    line('lv01-14', () => {
      tap(() => form('Heartworm 4dx').contains('button', 'Fill normal values'));
      form('Heartworm 4dx').find('select[aria-label="Heartworm value"]').should('have.value', 'Negative');
    });
    line('lv01-15', () => choose(() => form('Heartworm 4dx').find('select[aria-label="Heartworm value"]'), 'Positive'));
    line('lv01-16', () => pointAt(() => form('Heartworm 4dx').find('.lab-result-form__flag'), 3500));
    line('lv01-17', () => {
      tap(() => form('Heartworm 4dx').contains('button', 'Save results'));
      lineFor('Heartworm 4Dx').find('.lab-chip', { timeout: 30000 }).should('contain.text', '1 abnormal');
    });
    line('lv01-17b', () => pointAt(() => lineFor('Heartworm 4Dx').find('.lab-chip'), 3500));
    line('lv01-18');
    line('lv01-19');
    finish();
  });
});

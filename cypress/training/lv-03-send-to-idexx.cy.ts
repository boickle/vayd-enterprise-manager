/// <reference types="cypress" />
/**
 * Training video LV-03: send tests to IDEXX from the visit (docs/training/scripts/labs/LV-03-send-to-idexx.md).
 * TEST stack with IDEXX's sandbox practice (owner, Nov 8, 2026: a demo, not live). Demo names: Maria Rivera's cat
 * Juniper, Dr. Avery Lane, Jordan Pike (tech). Juniper has no birthdate, so Scout asks for one.
 */
import '../support/e2e';
import { schedulingWorld, signInAsScheduling } from '../support/schedulingWorld';
import { finish, line, loadNarration, pointAt, startClock, tap, typeSlowly } from './trainingKit';
import { labsDb, labsSetup, soapPath, visitToday } from './labsTraining';

describe('Training: LV-03 send to IDEXX', () => {
  it('LV-03', () => {
    const w = schedulingWorld();
    const juniper = w.households.A.activePetIds[1];
    loadNarration();
    labsSetup([juniper]);
    cy.exec(`psql -q -d ${labsDb()} -c "UPDATE patients SET dob=NULL WHERE id=${juniper}"`);
    visitToday({ household: 'A', petId: juniper, reason: 'Drinking more for two weeks.', startsMinutesAgo: 30 }).then((v) =>
      signInAsScheduling('technician', soapPath(v.apptId, juniper, v.clientId))
    );
    const charge = () => cy.get('input[placeholder^="Type here to add a charge"], input[placeholder="Add a charge for Juniper"]').filter(':visible').first();
    cy.get('input[placeholder^="Type here to add a charge"]', { timeout: 60000 }).should('exist');
    cy.wait(2000);
    const lineFor = (text: string) => cy.contains('[id^="checkout-line-"]', text, { timeout: 30000 });
    const modal = () => cy.contains('[role="dialog"]', 'Send to IDEXX ·', { timeout: 30000 });

    startClock();
    line('lv03-01');
    line('lv03-02', () => pointAt(() => cy.contains('Drinking more for two weeks').first(), 3000));
    line('lv03-03');
    line('lv03-04', () => typeSlowly(charge, 'CBC'));
    line('lv03-05', () => {
      tap(() => cy.contains('.soap-plan-result-name', 'CBC - standard', { timeout: 20000 }).closest('button'));
      lineFor('CBC - standard').find('.idexx-chip').should('contain.text', 'Not sent');
    });
    line('lv03-06', () => pointAt(() => lineFor('CBC - standard').find('.idexx-chip'), 3000));
    line('lv03-07', () => {
      tap(() => cy.contains('.idexx-send-strip button', 'Send to IDEXX'));
      modal().should('be.visible');
    });
    line('lv03-08', () => pointAt(() => modal().find('.idexx-send__test').first(), 3000));
    line('lv03-09', () => pointAt(() => modal().contains('label', 'Veterinarian').find('select'), 3500));
    line('lv03-10', () => pointAt(() => modal().contains('label', 'Collected').find('input'), 3000));
    line('lv03-11', () => {
      modal().contains('label', 'Birthdate').find('input', { timeout: 30000 }).should('exist');
      pointAt(() => modal().contains('IDEXX needs the'), 1800);
      typeSlowly(() => modal().contains('label', 'Birthdate').find('input'), '2019-05-01');
    });
    line('lv03-12', () => pointAt(() => modal().find('.idexx-send__how'), 2500));
    line('lv03-13', () => {
      tap(() => modal().contains('button', /Send 1 test to IDEXX/));
      cy.contains('IDEXX · Juniper', { timeout: 90000 }).should('be.visible');
    });
    line('lv03-14', () => pointAt(() => cy.contains('IDEXX · Juniper').parent(), 3500));
    line('lv03-15');
    finish();
  });
});

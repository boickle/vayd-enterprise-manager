/// <reference types="cypress" />
/**
 * Training video, EMR V12: a tech visit written up as a medical note and signed by a licensed tech
 * (docs/training/emr-visit-workflow-video-script.md). TEST stack, demo names: Jordan Pike (tech, licensed for this
 * video), Maria Rivera's dog Maple (nail trim) and and Tom Chen's dog Biscuit (the note an unlicensed tech can't sign).
 */
import '../support/e2e';
import { resetSeededHouseholdsInDb, schedulingApi, schedulingWorld, signInAsScheduling } from '../support/schedulingWorld';
import { finish, line, loadNarration, offCamera, pointAt, startClock, tap, typeSlowly } from './trainingKit';

const TZ = 'America/New_York';
const ymdNy = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);

describe('Training: EMR V12 medical note', () => {
  it('V12', () => {
    const w = schedulingWorld();
    const maple = w.households.A.activePetIds[0];
    const biscuit = w.households.B.petId;
    const tech = w.employees.technician;
    loadNarration();

    // Setup, before the clock.
    resetSeededHouseholdsInDb();
    const db = String(Cypress.env('SCH_DB'));
    expect(db, 'CYPRESS_SCH_DB must be a vayd_api_test* database').to.match(/^vayd_api_test[A-Za-z0-9_]*$/);
    const license = (on: boolean) =>
      cy.exec(
        `psql -q -d ${db} -c "UPDATE employees SET \\"isLicensed\\"=${on}, \\"licenseType\\"=${on ? "'technician'" : 'NULL'}, \\"licenseNumber\\"=${on ? "'NC-RVT-01188'" : 'NULL'} WHERE id=${tech}"`,
        { log: false }
      );
    license(true);
    const appt: Record<number, number> = {};
    const start = new Date(Math.floor((Date.now() - 30 * 60_000) / (15 * 60_000)) * 15 * 60_000);
    [
      [maple, w.households.A.clientId, 0],
      [biscuit, w.households.B.clientId, 60],
    ].forEach(([patientId, clientId, offset]) => {
      const s = new Date(start.getTime() + Number(offset) * 60_000);
      schedulingApi<{ id: number }>('cl', 'POST', '/appointments', {
        practiceId: w.practiceId,
        primaryProviderId: w.doctors.A,
        clientId,
        patientId,
        appointmentTypeId: w.types.medical,
        appointmentStart: s.toISOString(),
        appointmentEnd: new Date(s.getTime() + 30 * 60_000).toISOString(),
        description: 'Nail trim',
        bookedViaRouting: true,
      }).then((res) => (appt[Number(patientId)] = res.body.id));
    });
    // Biscuit's note exists before the clock, so it opens quickly for the unlicensed tech later.
    cy.then(() =>
      schedulingApi('technician', 'POST', '/soap-encounters', {
        practiceId: w.practiceId,
        appointmentId: appt[biscuit],
        patientId: biscuit,
        clientId: w.households.B.clientId,
        mode: 'medical_note',
      })
    );
    cy.then(() =>
      signInAsScheduling('technician', `/schedule/scheduler?fromMyDay=1&date=${ymdNy(new Date())}&provider=${w.doctors.A}`)
    );
    cy.contains('button', /^Day$/, { timeout: 30000 }).click();
    cy.wait(2500);
    cy.then(() =>
      cy
        .get(`[data-appt-id="${appt[maple]}"]`, { timeout: 30000 })
        .first()
        .should(($el) => {
          $el[0].scrollIntoView({ block: 'center' });
          expect($el[0].getBoundingClientRect().top, 'visit on screen').to.be.within(150, 780);
        })
    );
    cy.wait(1500);

    const visit = () => cy.get(`[data-appt-id="${appt[maple]}"]`).first();
    const history = () => cy.get('textarea[placeholder^="Why they are here"]');
    const plan = () => cy.get('textarea[placeholder^="What was given today"]');
    const tab = (name: string) => cy.contains('[role="tablist"][aria-label="Medical note sections"] [role="tab"]', name);
    const wrapUp = () => cy.contains('.soap-header-actions button', 'Wrap up');

    startClock();
    line('v12-01');
    line('v12-02', () => {
      cy.then(() => pointAt(visit, 1200));
      cy.task('trainingClick', null, { log: false });
      cy.then(() => visit().rightclick());
      cy.wait(400);
    });
    line('v12-03', () => {
      pointAt(() => cy.contains('.scheduler-ctx-parent-wrap', 'On Visit Day'), 1500);
      cy.contains('.scheduler-ctx-parent-wrap', 'On Visit Day').trigger('mouseover');
      cy.wait(300);
    });
    line('v12-04', () => tap(() => cy.contains('button[role="menuitem"]', /Start Encounter|Edit Encounter/)));
    line('v12-05', () => {
      tap(() => cy.contains('.scheduler-modal-encounter-choice-title', /^Medical note$/));
      history().should('exist');
    });
    line('v12-06', () => typeSlowly(history, 'Nail trim. Doing well at home, no concerns from the owner.'));
    line('v12-07', () => {
      tap(() => tab('Plan'));
      plan().should('exist');
    });
    line('v12-08', () => typeSlowly(plan, 'Trimmed all nails, no bleeding. Next trim in 6 weeks.'));
    line('v12-09', () => pointAt(() => cy.contains('button', 'Start AI scribe').first(), 3000));
    line('v12-10', () => tap(() => tab('Checkout prep')));
    line('v12-11', () => tap(() => tab('Client email')));
    line('v12-12', () => {
      tap(() => cy.contains('.soap-header-actions button', 'Switch to SOAP'));
      cy.contains('[role="dialog"]', 'Switch this medical note to a SOAP', { timeout: 20000 }).should('exist');
    });
    line('v12-13', () => {
      pointAt(() => cy.contains('[role="dialog"]', 'Switch this medical note to a SOAP'), 3500);
    });
    line('v12-13b', () => tap(() => cy.contains('[role="dialog"] button', 'Cancel')));
    line('v12-14', () => {
      tap(wrapUp);
      cy.location('pathname', { timeout: 60000 }).should('not.include', '/note/');
    });
    // Signing in again as an unlicensed tech reloads the whole app: that wait is cut from the video.
    offCamera(() => {
      license(false);
      cy.then(() => cy.visit(`/schedule/note/${appt[biscuit]}/${biscuit}?clientId=${w.households.B.clientId}`));
      cy.get('textarea[placeholder^="Why they are here"]', { timeout: 60000 }).should('exist');
      cy.wait(800);
    });
    line('v12-15');
    line('v12-16', () => {
      pointAt(wrapUp, 2500);
      pointAt(() => cy.contains('Only a licensed veterinarian or licensed technician'), 3000);
    });
    line('v12-17');
    line('v12-18');
    finish();
  });
});

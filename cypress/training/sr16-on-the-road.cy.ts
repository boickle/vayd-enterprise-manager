/// <reference types="cypress" />
/**
 * Training video SR-16: On the road, On My Way and Start / End Visit
 * (docs/training/scripts/scheduling-routing/SR-16-on-the-road.md).
 * TEST stack only. Biscuit Chen has a visit today at 11:00 with Dr. Lane. Signed in as Dr. Avery Lane.
 * The On My Way text is captured on the training stack (sms.jsonl), never sent. "Send to actual client" is never clicked.
 */
import '../support/e2e';
import { includeSeededDoctorsInProviderList, schedulingApi, schedulingWorld, signInAsScheduling } from '../support/schedulingWorld';
import { resetDemo } from './probes-sr/srKit';
import { hideNonProdBanner, menuItem, openMenuGroup, rightClickVisit } from './srRecord';
import { finish, line, loadNarration, pointAt, startClock, tap, typeSlowly } from './trainingKit';

describe('Training: SR-16 on the road', () => {
  it('SR-16', () => {
    const w = schedulingWorld();
    loadNarration();
    hideNonProdBanner();
    resetDemo();
    const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
    // Today 11:00 New York (EST, UTC-5 in November).
    const start = new Date(`${ymd}T16:00:00.000Z`);
    let id = 0;
    schedulingApi<{ id: number }>('cl', 'POST', '/appointments', {
      practiceId: w.practiceId, primaryProviderId: w.doctors.A, clientId: w.households.B.clientId, patientId: w.households.B.petId,
      appointmentTypeId: w.types.recheck, appointmentStart: start.toISOString(),
      appointmentEnd: new Date(start.getTime() + 45 * 60_000).toISOString(), description: 'Ear recheck', bookedViaRouting: true,
    }).then((r) => (id = r.body.id));
    Cypress.config('scrollBehavior', 'center');
    includeSeededDoctorsInProviderList();
    signInAsScheduling('doctorA', `/schedule/scheduler?fromMyDay=1&date=${ymd}&provider=${w.doctors.A}`);
    cy.get('[data-appt-id]', { timeout: 60000 }).should('have.length.at.least', 1);
    cy.contains('Loading drive times', { timeout: 60000 }).should('not.exist');
    cy.wait(1500);

    const record = () => {
      startClock();
      line('sr16-01');
      line('sr16-02', () => pointAt(() => cy.get(`[data-appt-id="${id}"]`).first(), 3000));
      line('sr16-03');
      line('sr16-04', () => {
        rightClickVisit(id);
        openMenuGroup('On Visit Day');
        menuItem('Send On My Way Text');
        cy.contains(/Minutes away/i, { timeout: 30000 }).should('be.visible');
      });
      line('sr16-05', () => {
        cy.contains(/Minutes away/i).parent().find('input').first().clear();
        typeSlowly(() => cy.contains(/Minutes away/i).parent().find('input').first(), '15');
      });
      line('sr16-06', () => pointAt(() => cy.get('[role="dialog"] textarea').filter(':visible').first(), 4500));
      line('sr16-07', () => {
        tap(() => cy.contains('[role="dialog"] button', /^Send message$/));
        cy.contains(/Minutes away/i, { timeout: 30000 }).should('not.exist');
      });
      line('sr16-08');
      line('sr16-09', () => {
        rightClickVisit(id);
        openMenuGroup('On Visit Day');
        menuItem('Start / End Visit');
        cy.contains(/Scheduled:/, { timeout: 30000 }).should('be.visible');
        pointAt(() => cy.contains(/Scheduled:/).first(), 2500);
      });
      line('sr16-10', () => tap(() => cy.contains('button', /^Now \(start\)$/)));
      line('sr16-11', () => {
        tap(() => cy.contains('[role="dialog"] button', /^Save$/));
        cy.contains(/Scheduled:/, { timeout: 30000 }).should('not.exist');
      });
      line('sr16-12');
      line('sr16-13');
      finish();
    };
    cy.then(() => record());
  });
});

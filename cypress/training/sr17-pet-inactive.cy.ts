/// <reference types="cypress" />
/**
 * Training video SR-17: When a pet dies or is made inactive, what closes on the schedule
 * (docs/training/scripts/scheduling-routing/SR-17-pet-inactive-closes-schedule.md).
 * TEST stack only. Juniper Rivera has a Wellness visit and a pending Recheck follow-up. Casey Morgan (CL) inactivates
 * her from the chart (Passed away). The demo reset brings Juniper back for the next take.
 */
import '../support/e2e';
import { includeSeededDoctorsInProviderList, schedulingApi, schedulingWorld, signInAsScheduling } from '../support/schedulingWorld';
import { resetDemo, srBook } from './probes-sr/srKit';
import { hideNonProdBanner, menuItem, openMenuGroup, rightClickVisit } from './srRecord';
import { choose, finish, line, loadNarration, pointAt, startClock, tap } from './trainingKit';

describe('Training: SR-17 pet inactive', () => {
  it('SR-17', () => {
    const w = schedulingWorld();
    loadNarration();
    hideNonProdBanner();
    resetDemo();
    const db = String(Cypress.env('SCH_DB'));
    expect(db).to.match(/^vayd_api_test[A-Za-z0-9_]*$/);
    cy.exec(`psql -d ${db} -c "update appointments set \\"isActive\\"=false where \\"isDeleted\\"=true and \\"isActive\\"=true" -c "delete from forward_bookings where \\"clientId\\" in (${w.households.A.clientId})"`);
    schedulingApi('doctorA', 'POST', '/forward-bookings', {
      practiceId: w.practiceId, clientId: w.households.A.clientId, patientId: w.households.A.activePetIds[1],
      intervalAmount: 1, intervalUnit: 'months', appointmentTypeId: w.types.recheck, primaryProviderId: w.doctors.A,
      description: 'Recheck', createdVia: 'manual',
    });
    let id = 0;
    let ymd = '';
    srBook('juniper', 13, 30, 'wellness', 60, 'A', 'Annual wellness').then((r) => { id = r.id; ymd = r.ymd; });
    Cypress.config('scrollBehavior', 'center');
    includeSeededDoctorsInProviderList();
    cy.then(() => signInAsScheduling('cl', `/schedule/scheduler?fromMyDay=1&date=${ymd}&provider=${w.doctors.A}`));
    cy.get('[data-appt-id]', { timeout: 60000 }).should('have.length.at.least', 1);
    cy.contains('Loading drive times', { timeout: 60000 }).should('not.exist');
    cy.wait(1500);

    const dlg = () => cy.contains(/Inactivating this patient/i).parents().filter((_, el) => /Choose a reason|Accept/.test(el.innerText)).first();
    const record = () => {
      startClock();
      line('sr17-01', () => pointAt(() => cy.get(`[data-appt-id="${id}"]`).first(), 3000));
      line('sr17-02', () => {
        rightClickVisit(id);
        openMenuGroup('Patient');
        menuItem('View Chart');
        cy.contains('button', /^Deactivate$/, { timeout: 60000 }).should('exist');
      });
      line('sr17-03');
      line('sr17-04', () => {
        tap(() => cy.contains('button', /^Deactivate$/));
        cy.contains(/Inactivating this patient/i, { timeout: 30000 }).should('be.visible');
      });
      line('sr17-05', () => pointAt(() => cy.contains(/Accept will cancel the items below/i), 3500));
      line('sr17-06', () => choose(() => dlg().find('select').first(), 'Passed away'));
      line('sr17-07', () => pointAt(() => cy.contains(/Removing 1 follow-up/i).parent(), 6000));
      line('sr17-08', () => pointAt(() => cy.contains(/Cancelling the following appointment/i).parent(), 3500));
      line('sr17-09', () => pointAt(() => cy.contains(/Memberships/).first(), 3500));
      line('sr17-10', () => {
        cy.contains('button', /^Accept and inactivate$/).scrollIntoView();
        tap(() => cy.contains('button', /^Accept and inactivate$/));
        cy.contains(/Inactivating this patient/i, { timeout: 30000 }).should('not.exist');
      });
      line('sr17-11');
      line('sr17-12');
      finish();
    };
    cy.then(() => record());
  });
});

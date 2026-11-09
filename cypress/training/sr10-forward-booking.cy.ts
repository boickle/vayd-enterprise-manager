/// <reference types="cypress" />
/**
 * Training video SR-10: Work the forward booking list
 * (docs/training/scripts/scheduling-routing/SR-10-forward-booking-list.md).
 * TEST stack only. Dr. Lane sent two follow-ups: Maple (Recheck in 2 weeks) and Juniper (Wellness in 1 month).
 * Casey Morgan (CL) books Maple's and points at Book later on Juniper's.
 */
import '../support/e2e';
import { includeSeededDoctorsInProviderList, schedulingApi, schedulingWorld, signInAsScheduling } from '../support/schedulingWorld';
import { resetDemo } from './probes-sr/srKit';
import { hideNonProdBanner } from './srRecord';
import { choose, finish, line, loadNarration, offCamera, pointAt, startClock, tap } from './trainingKit';

describe('Training: SR-10 forward booking list', () => {
  it('SR-10', () => {
    const w = schedulingWorld();
    loadNarration();
    hideNonProdBanner();
    resetDemo();
    const db = String(Cypress.env('SCH_DB'));
    expect(db).to.match(/^vayd_api_test[A-Za-z0-9_]*$/);
    cy.exec(`psql -d ${db} -c "delete from forward_bookings where \\"clientId\\" in (${w.households.A.clientId},${w.households.B.clientId})"`, { failOnNonZeroExit: false });
    const fb = (petIdx: number, amount: number, unit: string, type: number, description: string) =>
      schedulingApi('doctorA', 'POST', '/forward-bookings', {
        practiceId: w.practiceId, clientId: w.households.A.clientId, patientId: w.households.A.activePetIds[petIdx],
        intervalAmount: amount, intervalUnit: unit, appointmentTypeId: type, primaryProviderId: w.doctors.A,
        description, createdVia: 'manual',
      });
    fb(0, 2, 'weeks', w.types.recheck, 'Recheck left hind leg');
    fb(1, 1, 'months', w.types.wellness, 'Annual wellness');
    Cypress.config('scrollBehavior', 'center');
    includeSeededDoctorsInProviderList();
    signInAsScheduling('cl', '/schedule/scheduling-tools/forward-booking');
    cy.contains('Maple', { timeout: 60000 }).should('exist');
    cy.wait(2000);

    const card = (pet: string) =>
      cy.contains(pet).parents().filter((_, el) => /Book later/.test(el.innerText) && el.innerText.includes(pet)).first();
    const record = () => {
      startClock();
      line('sr10-01');
      line('sr10-02', () => pointAt(() => cy.contains('button, [role="tab"]', /^Needs booking/).first().parent(), 4500));
      line('sr10-03');
      line('sr10-04', () => pointAt(() => card('Maple'), 5000));
      line('sr10-05', () => pointAt(() => card('Maple').contains(/Contact log/).first(), 3500));
      line('sr10-06', () => {
        tap(() => card('Maple').contains('button', /^Book$/));
        cy.contains('button', /^Get Best Route$/, { timeout: 30000 }).should('exist');
      });
      line('sr10-07', () => {
        // Follow-ups start with no type; the CL chooses it (owner, Nov 9, 2026).
        choose(
          () => cy.get('select').filter(':visible').filter((_, el) => Array.from((el as HTMLSelectElement).options).some((o) => o.text === 'Recheck')).first(),
          'Recheck'
        );
      });
      line('sr10-07b', () => {
        tap(() => cy.contains('button', /^Get Best Route$/).last());
        cy.get('body').then(($b) => {
          if ($b.find('button:contains("Search anyway")').length) cy.contains('button', 'Search anyway').click();
        });
        cy.contains('button', 'View Placement', { timeout: 60000 }).should('exist');
        tap(() => cy.contains('button', 'View Placement').first());
        cy.get('.scheduler-edit-preview-popover-change', { timeout: 30000 }).should('exist');
        tap(() => cy.contains('button', /^Book$/).filter(':visible').first());
        cy.contains('[role="dialog"] button', /^Book appointment/, { timeout: 60000 }).should('exist');
        cy.contains('[role="dialog"] button', /^Book appointment/).scrollIntoView();
        tap(() => cy.contains('[role="dialog"] button', /^Book appointment/));
        cy.contains('[role="dialog"] button', /^Book appointment/, { timeout: 60000 }).should('not.exist');
      });
      offCamera(() => {
        cy.get('body').then(($b) => {
          if ($b.find('button:contains("Exit forward booking")').length) cy.contains('button', 'Exit forward booking').click({ force: true });
        });
        cy.wait(1500);
        signInAsScheduling('cl', '/schedule/scheduling-tools/forward-booking');
        cy.contains('Juniper', { timeout: 60000 }).should('exist');
        cy.document().then((doc) => {
          const st = doc.createElement('style');
          st.textContent = '.app-nonprod-banner{display:none!important}.app-root--nonprod{--app-nonprod-banner-height:0px!important;padding-top:0!important}';
          doc.head.appendChild(st);
        });
        cy.wait(800);
      });
      line('sr10-08', () => pointAt(() => cy.contains('button, [role="tab"]', /^Needs booking/).first(), 3000));
      line('sr10-09', () => pointAt(() => card('Juniper').contains('button', /^Book later/), 3500));
      line('sr10-10', () => {
        pointAt(() => card('Juniper').contains('button', /Mark complete/), 2500);
        pointAt(() => card('Juniper').contains('button', /^Remove/), 2500);
      });
      line('sr10-11');
      finish();
    };
    cy.then(() => record());
  });
});

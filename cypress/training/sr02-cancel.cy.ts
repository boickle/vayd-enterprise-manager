/// <reference types="cypress" />
/**
 * Training video SR-02: Cancel a visit: Remove, with a reason (docs/training/scripts/scheduling-routing/SR-02-cancel-a-visit.md).
 * TEST stack only. Casey Morgan (CL). Maple 3:00 pm recheck (removed); Biscuit 11:00 recheck already started (refused).
 */
import '../support/e2e';
import { includeSeededDoctorsInProviderList, schedulingApi, schedulingWorld, signInAsScheduling } from '../support/schedulingWorld';
import { nextWeekdayNy } from '../support/schedulingRemove';
import { resetDemo, srBook } from './probes-sr/srKit';
import { hideNonProdBanner, menuItem, openMenuGroup, rightClickVisit } from './srRecord';
import { finish, line, loadNarration, pointAt, startClock, tap, typeSlowly } from './trainingKit';

describe('Training: SR-02 cancel a visit', () => {
  it('SR-02', () => {
    const w = schedulingWorld();
    loadNarration();
    hideNonProdBanner();
    resetDemo();
    let maple = 0;
    let biscuit = 0;
    srBook('maple', 9, 0, 'medical', 60, 'A', 'Limping on the left hind leg');
    srBook('biscuit', 11, 0, 'recheck', 45, 'A', 'Ear recheck').then(({ id }) => {
      biscuit = id;
      schedulingApi('doctorA', 'POST', `/appointments/${id}/actual-start`, {});
    });
    srBook('maple', 15, 0, 'recheck', 30, 'A', 'Recheck leg').then(({ id }) => (maple = id));
    const { ymd } = nextWeekdayNy(9);
    includeSeededDoctorsInProviderList();
    signInAsScheduling('cl', `/schedule/scheduler?fromMyDay=1&date=${ymd}&provider=${w.doctors.A}`);
    cy.get('[data-appt-id]', { timeout: 60000 }).should('have.length.at.least', 3);
    cy.contains('Loading drive times', { timeout: 60000 }).should('not.exist');
    cy.wait(1500);
    cy.then(() => record());

    function record() {
      const dialog = () => cy.get('[role="dialog"]');
      startClock();
      line('sr02-01');
      line('sr02-02', () => pointAt(() => cy.get(`[data-appt-id="${maple}"]`).first(), 3500));
      line('sr02-03');
      line('sr02-04', () => rightClickVisit(maple));
      line('sr02-05', () => openMenuGroup('Scheduling'));
      line('sr02-06', () => menuItem(/^Remove$/));
      line('sr02-07', () => pointAt(() => dialog().contains('This visit will be marked cancelled'), 3500));
      line('sr02-08', () => tap(() => dialog().contains('button', 'Remove Visit')));
      line('sr02-09', () => pointAt(() => dialog().contains('Enter a reason for removing this visit.'), 2500));
      line('sr02-10', () => typeSlowly(() => dialog().find('textarea'), 'Client cancelled: Maple is feeling better'));
      line('sr02-11', () => {
        tap(() => dialog().contains('button', 'Remove Visit'));
        cy.get('[role="dialog"]').should('not.exist');
      });
      line('sr02-12', () => pointAt(() => cy.get('.scheduler-day-body').eq(1), 3000));
      line('sr02-13', () => pointAt(() => cy.get(`[data-appt-id="${biscuit}"]`).first(), 2500));
      line('sr02-14', () => rightClickVisit(biscuit));
      line('sr02-15', () => openMenuGroup('Scheduling'));
      line('sr02-16', () => menuItem(/^Remove$/));
      line('sr02-17', () => typeSlowly(() => dialog().find('textarea'), 'Client cancelled'));
      line('sr02-18', () => tap(() => dialog().contains('button', 'Remove Visit')));
      line('sr02-19', () => pointAt(() => dialog().contains('This visit has been started'), 4500));
      line('sr02-20', () => tap(() => dialog().contains('button', 'Cancel')));
      line('sr02-21');
      line('sr02-22');
      finish();
    }
  });
});

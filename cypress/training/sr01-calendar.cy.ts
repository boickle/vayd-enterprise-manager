/// <reference types="cypress" />
/**
 * Training video SR-01: Find your way around the calendar (docs/training/scripts/scheduling-routing/SR-01-the-calendar.md).
 * TEST stack only. Casey Morgan (CL) on Dr. Avery Lane's calendar: Maple 9:00, Biscuit 11:00, Juniper 1:30.
 */
import '../support/e2e';
import { includeSeededDoctorsInProviderList, schedulingWorld, signInAsScheduling } from '../support/schedulingWorld';
import { nextWeekdayNy } from '../support/schedulingRemove';
import { resetDemo, srBook } from './probes-sr/srKit';
import { hideNonProdBanner, menuItem, openMenuGroup, rightClickVisit } from './srRecord';
import { choose, finish, line, loadNarration, pointAt, startClock, tap } from './trainingKit';

describe('Training: SR-01 the calendar', () => {
  it('SR-01', () => {
    const w = schedulingWorld();
    loadNarration();
    hideNonProdBanner();
    resetDemo();
    let maple = 0;
    srBook('maple', 9, 0, 'medical', 60, 'A', 'Limping on the left hind leg').then(({ id }) => (maple = id));
    srBook('biscuit', 11, 0, 'recheck', 45, 'A', 'Ear recheck');
    srBook('juniper', 13, 30, 'wellness', 60, 'A', 'Annual wellness');
    const { ymd } = nextWeekdayNy(9);
    includeSeededDoctorsInProviderList();
    signInAsScheduling('cl', `/schedule/scheduler?fromMyDay=1&date=${ymd}&provider=${w.doctors.A}`);
    cy.get('[data-appt-id]', { timeout: 60000 }).should('have.length.at.least', 3);
    cy.contains('Loading drive times', { timeout: 60000 }).should('not.exist');
    cy.wait(1500);
    // Queued after the bookings return, so the visit id is known when each step is built.
    cy.then(() => record());
    const card = () => cy.get(`[data-appt-id="${maple}"]`).first();

    function record() {
    startClock();
    line('sr01-01');
    line('sr01-02', () => pointAt(() => cy.get('.scheduler-day-body').eq(1), 3000));
    line('sr01-03', () => pointAt(card, 3500));
    line('sr01-04', () => choose(() => cy.get('select').filter(':visible').filter((_, el) => Array.from((el as HTMLSelectElement).options).some((o) => o.text === 'Avery Lane')).first(), 'Avery Lane'));
    line('sr01-05', () => pointAt(() => cy.contains('button', /^Today$/).first(), 2500));
    line('sr01-06', () => tap(() => cy.contains('button', '→').first()));
    line('sr01-07', () => tap(() => cy.contains('button', '←').first()));
    line('sr01-08', () => tap(() => cy.contains('button', /^Day$/)));
    line('sr01-09', () => tap(() => cy.contains('button', /^Week$/)));
    line('sr01-10', () => pointAt(() => cy.get('.scheduler-day-header-metrics-row').first(), 4000));
    line('sr01-11', () => pointAt(card, 5000));
    line('sr01-12', () => pointAt(() => card().find('.scheduler-appt-card-icons-tr'), 3000));
    line('sr01-13', () => rightClickVisit(maple));
    line('sr01-14', () => openMenuGroup('Scheduling'));
    line('sr01-15', () => openMenuGroup('Visit Prep'));
    line('sr01-16', () => openMenuGroup('On Visit Day'));
    line('sr01-17', () => openMenuGroup('Patient'));
    line('sr01-18', () => openMenuGroup('Client'));
    line('sr01-19', () => openMenuGroup('Scheduling'));
    line('sr01-19b', () => menuItem('View appointment'));
    line('sr01-20', () => pointAt(() => cy.get('[role="dialog"]').contains(/Window|ETA\/ETD/).first(), 4500));
    line('sr01-21', () => pointAt(() => cy.get('[role="dialog"]').contains(/Phone/).first(), 3500));
    line('sr01-22');
    finish();
    }
  });
});

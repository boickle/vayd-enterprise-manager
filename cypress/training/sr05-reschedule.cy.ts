/// <reference types="cypress" />
/**
 * Training video SR-05: Move or reschedule a visit (docs/training/scripts/scheduling-routing/SR-05-move-or-reschedule.md).
 * TEST stack only (routing is fake: every drive is 15 minutes). Casey Morgan (CL) moves Biscuit Chen's recheck through
 * routing, then shows the "Reschedule which visits?" question on the Riveras' day.
 */
import '../support/e2e';
import { includeSeededDoctorsInProviderList, schedulingWorld, signInAsScheduling } from '../support/schedulingWorld';
import { nextWeekdayNy } from '../support/schedulingRemove';
import { resetDemo, srBook } from './probes-sr/srKit';
import { hideNonProdBanner, menuItem, openMenuGroup, rightClickVisit } from './srRecord';
import { finish, line, loadNarration, pointAt, startClock, tap } from './trainingKit';

describe('Training: SR-05 move or reschedule', () => {
  it('SR-05', () => {
    const w = schedulingWorld();
    loadNarration();
    hideNonProdBanner();
    resetDemo();
    const ids: Record<string, number> = {};
    srBook('biscuit', 11, 0, 'recheck', 45, 'A', 'Ear recheck').then(({ id }) => (ids.biscuit = id));
    srBook('juniper', 13, 30, 'wellness', 60, 'A', 'Annual wellness').then(({ id }) => (ids.juniper = id));
    srBook('maple', 15, 0, 'recheck', 30, 'A', 'Recheck the left hind leg').then(({ id }) => (ids.maple = id));
    const { ymd } = nextWeekdayNy(9);
    includeSeededDoctorsInProviderList();
    const home = `/schedule/scheduler?fromMyDay=1&date=${ymd}&provider=${w.doctors.A}`;
    signInAsScheduling('cl', home);
    cy.get('[data-appt-id]', { timeout: 60000 }).should('have.length.at.least', 3);
    cy.contains('Loading drive times', { timeout: 60000 }).should('not.exist');
    cy.wait(1500);

    const record = () => {
      startClock();
      line('sr05-01');
      line('sr05-02', () => pointAt(() => cy.get(`[data-appt-id="${ids.biscuit}"]`).first(), 3000));
      line('sr05-03');
      line('sr05-04', () => rightClickVisit(ids.biscuit));
      line('sr05-05', () => openMenuGroup('Scheduling'));
      line('sr05-06', () => {
        menuItem('Reschedule');
        cy.contains(/Moving Biscuit/, { timeout: 30000 }).should('be.visible');
        cy.contains('Loading', { timeout: 60000 }).should('not.exist');
      });
      line('sr05-07', () => pointAt(() => cy.contains(/Moving Biscuit/).first(), 4500));
      line('sr05-08', () => {
        tap(() => cy.contains('button', /^Get Best Route$/).last());
        cy.get('body').then(($b) => {
          if ($b.find('button:contains("Search anyway")').length) cy.contains('button', 'Search anyway').click();
        });
        cy.contains('button', 'View Placement', { timeout: 40000 }).should('exist');
      });
      line('sr05-09', () => pointAt(() => cy.contains(/Original booking score/).first(), 4000));
      line('sr05-10', () => pointAt(() => cy.get('.routing-result-option-card').first(), 4000));
      line('sr05-11', () => {
        tap(() => cy.contains('button', 'View Placement').first());
        cy.get('.scheduler-edit-preview-popover-change', { timeout: 30000 }).should('be.visible');
      });
      line('sr05-12', () => pointAt(() => cy.get('.scheduler-edit-preview-popover-change').first(), 4500));
      line('sr05-13', () => {
        tap(() => cy.contains('button', /^Reschedule$/));
        cy.contains('[role="dialog"] button', 'Reschedule appointment', { timeout: 30000 }).should('exist');
      });
      line('sr05-14', () => pointAt(() => cy.get('[role="dialog"]').contains(/^Was /).first().parent(), 4000));
      line('sr05-15', () => {
        cy.contains('[role="dialog"] button', 'Reschedule appointment').scrollIntoView();
        tap(() => cy.contains('[role="dialog"] button', 'Reschedule appointment'));
        cy.get('[role="dialog"]', { timeout: 30000 }).should('not.exist');
        cy.contains('Loading drive times', { timeout: 60000 }).should('not.exist');
      });
      line('sr05-16', () => {
        pointAt(() => cy.contains('[data-appt-id]', 'Biscuit').first(), 3500);
        // Back to the day view during this line, so the reload doesn't push the next clicks late.
        tap(() => cy.get('header a, header button').filter(':visible').filter((_, el) => el.innerText.trim() === 'Home').first());
        cy.get(`[data-appt-id="${ids.maple}"]`, { timeout: 60000 }).should('exist');
        cy.contains('Loading drive times', { timeout: 60000 }).should('not.exist');
      });
      line('sr05-17', () => pointAt(() => cy.get(`[data-appt-id="${ids.maple}"]`).first(), 3000));
      line('sr05-18', () => {
        rightClickVisit(ids.maple);
        openMenuGroup('Scheduling');
        menuItem('Reschedule');
        cy.contains('Reschedule which visits?', { timeout: 20000 }).should('be.visible');
      });
      line('sr05-19', () => {
        pointAt(() => cy.contains('Reschedule which visits?').parents('[role="dialog"], .scheduler-modal').first(), 5000);
        tap(() => cy.contains('button', /^Cancel$/));
      });
      line('sr05-20', () => {
        rightClickVisit(ids.maple);
        openMenuGroup('Scheduling');
        pointAt(() => cy.contains('button[role="menuitem"]', 'Explore alternatives'), 3000);
      });
      line('sr05-21', () => {
        pointAt(() => cy.contains('button[role="menuitem"]', 'Edit Appointment'), 3000);
        cy.get('body').type('{esc}');
      });
      line('sr05-22');
      finish();
    };
    cy.then(() => record());
  });
});

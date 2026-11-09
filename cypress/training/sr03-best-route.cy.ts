/// <reference types="cypress" />
/**
 * Training video SR-03: Book a visit with Get Best Route (docs/training/scripts/scheduling-routing/SR-03-book-with-get-best-route.md).
 * TEST stack only (routing is fake: every drive is 15 minutes). Casey Morgan (CL) books Biscuit Chen's recheck with Dr. Lane.
 */
import '../support/e2e';
import { includeSeededDoctorsInProviderList, schedulingWorld, signInAsScheduling } from '../support/schedulingWorld';
import { nextWeekdayNy } from '../support/schedulingRemove';
import { resetDemo, srBook } from './probes-sr/srKit';
import { hideNonProdBanner } from './srRecord';
import { choose, finish, line, loadNarration, pointAt, startClock, tap, typeSlowly } from './trainingKit';

describe('Training: SR-03 book with Get Best Route', () => {
  it('SR-03', () => {
    const w = schedulingWorld();
    loadNarration();
    hideNonProdBanner();
    resetDemo();
    srBook('maple', 9, 0, 'medical', 60, 'A', 'Limping on the left hind leg');
    srBook('juniper', 13, 30, 'wellness', 60, 'A', 'Annual wellness');
    const { ymd } = nextWeekdayNy(9);
    includeSeededDoctorsInProviderList();
    signInAsScheduling('cl', `/schedule/scheduler?fromMyDay=1&date=${ymd}&provider=${w.doctors.A}`);
    cy.get('[data-appt-id]', { timeout: 60000 }).should('have.length.at.least', 2);
    cy.contains('Loading drive times', { timeout: 60000 }).should('not.exist');
    cy.wait(1500);
    const typeSelect = () =>
      cy.get('select').filter(':visible').filter((_, el) => (el as HTMLSelectElement).options[0]?.text === 'Select type…').first();

    startClock();
    line('sr03-01');
    line('sr03-02', () => {
      tap(() => cy.get('header a, header button').filter(':visible').filter((_, el) => el.innerText.trim() === '+ Appointment').first());
      cy.get('input[placeholder="Type doctor name..."]', { timeout: 30000 }).should('be.visible');
    });
    line('sr03-03');
    line('sr03-04', () => pointAt(() => cy.contains('label, span, div', /^Date$/).first().parent(), 3500));
    line('sr03-05', () => pointAt(() => cy.get('input[placeholder="Type doctor name..."]'), 4500));
    line('sr03-07', () => choose(typeSelect, 'Recheck'));
    line('sr03-08', () => typeSlowly(() => cy.get('input[placeholder="Type last name..."]'), 'Chen'));
    line('sr03-09', () => {
      tap(() => cy.contains('button', 'Chen, Tom'));
      cy.contains('button', /^Biscuit$/, { timeout: 30000 }).should('be.visible');
      cy.contains(/^Zone North$/, { timeout: 30000 }).should('exist');
    });
    line('sr03-10', () => tap(() => cy.contains('button', /^Biscuit$/)));
    line('sr03-11', () => pointAt(() => cy.contains(/^Zone North$/), 3000));
    line('sr03-12', () => {
      tap(() => cy.contains('button', /^Get Best Route$/).last());
      cy.contains('button', 'View Placement', { timeout: 40000 }).should('exist');
    });
    line('sr03-13', () => pointAt(() => cy.get('.routing-result-option-card').first(), 6000));
    line('sr03-14', () => tap(() => cy.contains('button', 'View Placement').first()));
    line('sr03-15', () => pointAt(() => cy.contains('.scheduler-edit-preview-popover-change-k', 'Window').first().parent(), 3500));
    line('sr03-16', () => pointAt(() => cy.get('.scheduler-edit-preview-popover-contact').first(), 2500));
    line('sr03-17', () => tap(() => cy.contains('button', /^Book$/)));
    line('sr03-18', () => pointAt(() => cy.get('[role="dialog"]').contains('Biscuit').first(), 3000));
    line('sr03-19', () => typeSlowly(() => cy.get('[role="dialog"] textarea[placeholder="Notes for this visit…"]:enabled').first(), 'Ear recheck'));
    line('sr03-20', () => {
      tap(() => cy.contains('[role="dialog"] button', 'Book appointment'));
      cy.contains('Appointment saved to the schedule.', { timeout: 30000 });
      cy.contains('Loading drive times', { timeout: 60000 }).should('not.exist');
    });
    line('sr03-21', () => pointAt(() => cy.contains('[data-appt-id]', 'Biscuit').first(), 3500));
    line('sr03-22');
    finish();
  });
});

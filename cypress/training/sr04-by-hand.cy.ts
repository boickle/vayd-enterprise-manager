/// <reference types="cypress" />
/**
 * Training video SR-04: Book by hand on the calendar (docs/training/scripts/scheduling-routing/SR-04-book-by-hand.md).
 * TEST stack only. Casey Morgan (CL) double-clicks Tuesday 11:30 on Dr. Lane's week and books Biscuit Chen.
 */
import '../support/e2e';
import { includeSeededDoctorsInProviderList, schedulingWorld, signInAsScheduling } from '../support/schedulingWorld';
import { nextWeekdayNy } from '../support/schedulingRemove';
import { resetDemo, srBook } from './probes-sr/srKit';
import { hideNonProdBanner, markCalendarSpot } from './srRecord';
import { choose, finish, line, loadNarration, pointAt, startClock, tap, typeSlowly } from './trainingKit';

const dlg = '[role="dialog"]';
/** A booking-form field by its label (Field renders <label><div class="label">Name</div>…). */
const field = (name: string) =>
  cy.get(`${dlg} label`).filter((_, el) => (el.querySelector(':scope > .label')?.textContent ?? '').replace('*', '').trim() === name).first();

describe('Training: SR-04 book by hand', () => {
  it('SR-04', () => {
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
    // Week view, Sunday first: Tuesday is the third day column.
    markCalendarSpot(2, '11:00 AM', 30);
    cy.wait(1500);

    startClock();
    line('sr04-01');
    line('sr04-02', () => pointAt(() => cy.get('#sr-spot'), 3000));
    line('sr04-03');
    line('sr04-04', () => {
      tap(() => cy.get('#sr-spot'), 'dblclick');
      cy.get(dlg, { timeout: 20000 }).should('be.visible');
    });
    line('sr04-05', () => pointAt(() => cy.get(dlg).find('h2, h3, [class*="title"]').first().parent(), 3500));
    line('sr04-06', () => pointAt(() => field('Provider'), 2000));
    line('sr04-07', () => {
      choose(() => field('Appointment type').find('select'), 'Recheck');
      cy.get(`${dlg} input[placeholder^="Pet name, client name"]`, { timeout: 20000 }).should('be.visible');
    });
    line('sr04-08', () => {
      typeSlowly(() => cy.get(`${dlg} input[placeholder^="Pet name, client name"]`), 'Chen');
      cy.get(dlg).contains('button', /Biscuit/, { timeout: 20000 }).should('be.visible');
    });
    line('sr04-09', () => {
      tap(() => cy.get(dlg).contains('button', /Biscuit/).first());
      field('Patient').find('select', { timeout: 20000 }).should('exist');
    });
    line('sr04-10', () => pointAt(() => field('Patient'), 2000));
    line('sr04-11', () => pointAt(() => field('Duration'), 2000));
    line('sr04-12', () => typeSlowly(() => field('Description (optional)').find('textarea'), 'Ear recheck'));
    line('sr04-13', () => pointAt(() => cy.get('.scheduler-book-waitlist-optin'), 5000));
    line('sr04-14', () => {
      tap(() => cy.contains(`${dlg} button`, 'Preview on calendar'));
      cy.contains('Manual booking preview', { timeout: 30000 }).should('be.visible');
      cy.contains('button', /^Book$/, { timeout: 30000 }).should('not.be.disabled');
    });
    line('sr04-15', () => pointAt(() => cy.contains('Manual booking preview').parents().filter((_, el) => /Book/.test(el.innerText) && el.getBoundingClientRect().height > 120).first(), 5000));
    line('sr04-16', () => {
      tap(() => cy.contains('button', /^Book$/));
      cy.contains('Appointment saved to the schedule.', { timeout: 30000 });
      cy.contains('Loading drive times', { timeout: 60000 }).should('not.exist');
    });
    line('sr04-17', () => pointAt(() => cy.contains('[data-appt-id]', 'Biscuit').first(), 3500));
    line('sr04-18');
    finish();
  });
});

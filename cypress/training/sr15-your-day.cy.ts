/// <reference types="cypress" />
/**
 * Training video SR-15: Your day and week on the calendar
 * (docs/training/scripts/scheduling-routing/SR-15-your-day-and-week.md).
 * TEST stack only. Dr. Lane's next weekday: Maple 9:00, Biscuit 11:00, Juniper 1:30. Signed in as Dr. Avery Lane.
 * Maps and the printer icon are pointed at, not clicked (Maps leaves for Google; the PDF downloads).
 */
import '../support/e2e';
import { includeSeededDoctorsInProviderList, schedulingWorld, signInAsScheduling } from '../support/schedulingWorld';
import { resetDemo, srBook } from './probes-sr/srKit';
import { hideNonProdBanner, menuItem, openMenuGroup, rightClickVisit } from './srRecord';
import { finish, line, loadNarration, pointAt, startClock, tap } from './trainingKit';

describe('Training: SR-15 your day and week', () => {
  it('SR-15', () => {
    const w = schedulingWorld();
    loadNarration();
    hideNonProdBanner();
    resetDemo();
    const ids: Record<string, number> = {};
    let ymd = '';
    srBook('maple', 9, 0, 'medical', 60, 'A', 'Limping on the left hind leg').then((r) => { ids.maple = r.id; ymd = r.ymd; });
    srBook('biscuit', 11, 0, 'recheck', 45, 'A', 'Ear recheck');
    srBook('juniper', 13, 30, 'wellness', 60, 'A', 'Annual wellness');
    Cypress.config('scrollBehavior', 'center');
    includeSeededDoctorsInProviderList();
    cy.then(() => signInAsScheduling('doctorA', `/schedule/scheduler?fromMyDay=1&provider=${w.doctors.A}`));
    cy.get('[data-appt-id]', { timeout: 60000 }).should('have.length.at.least', 3);
    cy.contains('Loading drive times', { timeout: 60000 }).should('not.exist');
    cy.wait(1500);

    const record = () => {
      startClock();
      line('sr15-01');
      line('sr15-02', () => pointAt(() => cy.contains(/Primary provider/i).parent(), 3500));
      line('sr15-03');
      line('sr15-04', () => pointAt(() => cy.contains(/Points/).first().parents().filter((_, el) => /Drive/.test(el.innerText) && /PPDH/.test(el.innerText)).first(), 4500));
      line('sr15-05', () => {
        tap(() => cy.contains('button', /^Day$/).first());
        cy.then(() => {
          // Move to the demo day if Day view opened on another date.
          cy.get('body').then(($b) => {
            if (!$b.find(`[data-appt-id="${ids.maple}"]`).length) tap(() => cy.contains('button', /^→$/).filter(':visible').first());
          });
        });
        cy.get(`[data-appt-id="${ids.maple}"]`, { timeout: 60000 }).should('exist');
        cy.contains('Loading drive times', { timeout: 60000 }).should('not.exist');
      });
      line('sr15-06', () => pointAt(() => cy.get(`[data-appt-id="${ids.maple}"]`).first(), 4000));
      line('sr15-07', () => {
        rightClickVisit(ids.maple);
        openMenuGroup('Scheduling');
        menuItem('View appointment');
        cy.contains(/ETA/, { timeout: 30000 }).should('be.visible');
      });
      line('sr15-08', () => {
        pointAt(() => cy.contains(/ETA/).first().parent(), 2500);
        pointAt(() => cy.contains(/Window/).first().parent(), 2500);
        tap(() => cy.contains('Visit details', { matchCase: false }).parents().filter((_, el) => !!el.querySelector('button')).last().find('button').filter((_, el) => /^(×|✕|x)$/i.test(el.innerText.trim()) || el.getAttribute('aria-label') === 'Close').first());
        cy.contains('Visit details', { matchCase: false }).should('not.exist');
      });
      line('sr15-09', () => pointAt(() => cy.get('button[title="Open this day in Google Maps"]').filter(':visible').first(), 3500));
      line('sr15-10', () => pointAt(() => cy.get('button[title^="Download My Day"]').filter(':visible').first(), 3500));
      line('sr15-11', () => pointAt(() => cy.contains(/^RL$/).filter(':visible').first(), 3500));
      line('sr15-12');
      finish();
    };
    cy.then(() => record());
  });
});

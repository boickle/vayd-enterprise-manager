/// <reference types="cypress" />
/**
 * Training video SR-23: The most common scheduling mistakes (a recap tour).
 * TEST stack only. Dr. Lane's demo day. Casey Morgan (CL); the closed-days screen with the training admin token.
 * Page loads are cut (offCamera); every step only points.
 */
import '../support/e2e';
import { includeSeededDoctorsInProviderList, schedulingWorld, signInAsScheduling } from '../support/schedulingWorld';
import { resetDemo, srBook } from './probes-sr/srKit';
import { hideNonProdBanner, menuItem, openMenuGroup, rightClickVisit } from './srRecord';
import { finish, line, loadNarration, offCamera, pointAt, startClock } from './trainingKit';

const hideBanner = () =>
  cy.document().then((doc) => {
    const st = doc.createElement('style');
    st.textContent = '.app-nonprod-banner{display:none!important}.app-root--nonprod{--app-nonprod-banner-height:0px!important;padding-top:0!important}';
    doc.head.appendChild(st);
  });
const go = (role: string, path: string, ready: () => void) =>
  offCamera(() => {
    signInAsScheduling(role as any, path);
    ready();
    hideBanner();
    cy.wait(800);
  });

describe('Training: SR-23 common mistakes', () => {
  it('SR-23', () => {
    const w = schedulingWorld();
    loadNarration();
    hideNonProdBanner();
    resetDemo();
    const ids: Record<string, number> = {};
    let ymd = '';
    srBook('maple', 9, 0, 'medical', 60, 'A', 'Limping on the left hind leg').then((r) => { ids.maple = r.id; ymd = r.ymd; });
    srBook('biscuit', 11, 0, 'recheck', 45, 'A', 'Ear recheck').then((r) => (ids.biscuit = r.id));
    srBook('juniper', 13, 30, 'wellness', 60, 'A', 'Annual wellness').then((r) => (ids.juniper = r.id));
    Cypress.config('scrollBehavior', 'center');
    includeSeededDoctorsInProviderList();
    cy.then(() => signInAsScheduling('cl', `/schedule/scheduler?fromMyDay=1&date=${ymd}&provider=${w.doctors.A}`));
    cy.get('[data-appt-id]', { timeout: 60000 }).should('have.length.at.least', 3);
    cy.contains('Loading drive times', { timeout: 60000 }).should('not.exist');
    cy.wait(1500);

    const record = () => {
      startClock();
      line('sr23-01');
      line('sr23-02', () => pointAt(() => cy.get(`[data-appt-id="${ids.biscuit}"]`).first(), 3000));
      line('sr23-03', () => pointAt(() => cy.get(`[data-appt-id="${ids.maple}"]`).first(), 4000));
      line('sr23-04', () => pointAt(() => cy.get('header a, header button').filter(':visible').filter((_, el) => el.innerText.trim() === '+ Appointment').first(), 3500));
      line('sr23-05', () => {
        rightClickVisit(ids.biscuit);
        openMenuGroup('Scheduling');
        pointAt(() => cy.contains('button[role="menuitem"]', /^Reschedule$/), 2000);
        pointAt(() => cy.contains('button[role="menuitem"]', /^Remove$/), 2000);
        cy.get('body').type('{esc}');
      });
      go('cl', '/schedule/appointments', () => cy.contains('button, [role="tab"]', /^New/, { timeout: 60000 }).should('exist'));
      line('sr23-06', () => pointAt(() => cy.contains('button, [role="tab"]', /^New/).first(), 3500));
      go('cl', '/schedule/scheduling-tools/forward-booking', () => cy.contains('button, [role="tab"]', /^Needs booking/, { timeout: 60000 }).should('exist'));
      line('sr23-07', () => pointAt(() => cy.contains('button, [role="tab"]', /^Needs booking/).first(), 3500));
      go('cl', '/schedule/holds', () => cy.contains(/Calendar holds scheduled today/, { timeout: 60000 }).should('exist'));
      line('sr23-08', () => pointAt(() => cy.contains(/Calendar holds scheduled today/).first(), 4000));
      go('cl', '/schedule/scheduling-tools/texted-offers', () => cy.contains(/Active/, { timeout: 60000 }).should('exist'));
      line('sr23-09', () => pointAt(() => cy.contains('button, [role="tab"]', /^Active/).first(), 3500));
      go('cl', `/schedule/scheduler?fromMyDay=1&date=${ymd}&provider=${w.doctors.A}`, () => cy.get(`[data-appt-id="${ids.juniper}"]`, { timeout: 60000 }).should('exist'));
      offCamera(() => {
        rightClickVisit(ids.juniper);
        openMenuGroup('Patient');
        menuItem('View Chart');
        cy.contains('button', /^Deactivate$/, { timeout: 60000 }).should('exist');
        hideBanner();
        cy.wait(800);
      });
      line('sr23-10', () => pointAt(() => cy.contains('button', /^Deactivate$/), 3500));
      go('admin', '/settings', () => cy.contains('strong', /^Closed days$/, { timeout: 60000 }).scrollIntoView());
      line('sr23-11', () => pointAt(() => cy.contains('button', /^Add closed day$/), 3500));
      line('sr23-12');
      finish();
    };
    cy.then(() => record());
  });
});

/// <reference types="cypress" />
/**
 * Training video SR-09: The waitlist, add a family, then fill an opening
 * (docs/training/scripts/scheduling-routing/SR-09-waitlist.md).
 * TEST stack only. Biscuit (Tom Chen) has Monday 11:00 with Dr. Lane. Off camera, Juniper (Maria Rivera) is on the
 * waitlist with nothing booked. Casey Morgan (CL) adds Biscuit to the waitlist, then fills an opening for Juniper.
 */
import '../support/e2e';
import { includeSeededDoctorsInProviderList, schedulingWorld, signInAsScheduling } from '../support/schedulingWorld';
import { nextWeekdayNy } from '../support/schedulingRemove';
import { resetDemo, srBook } from './probes-sr/srKit';
import { hideNonProdBanner, menuItem, openMenuGroup, rightClickVisit } from './srRecord';
import { finish, line, loadNarration, offCamera, pointAt, startClock, tap, typeSlowly } from './trainingKit';

const hideBanner = () =>
  cy.document().then((doc) => {
    const st = doc.createElement('style');
    st.textContent = '.app-nonprod-banner{display:none!important}.app-root--nonprod{--app-nonprod-banner-height:0px!important;padding-top:0!important}';
    doc.head.appendChild(st);
  });

describe('Training: SR-09 waitlist', () => {
  it('SR-09', () => {
    const w = schedulingWorld();
    loadNarration();
    hideNonProdBanner();
    resetDemo();
    const db = String(Cypress.env('SCH_DB'));
    expect(db).to.match(/^vayd_api_test[A-Za-z0-9_]*$/);
    cy.exec(`psql -d ${db} -c "delete from slot_offers" -c "delete from waitlist_entries"`, { failOnNonZeroExit: false });
    Cypress.config('scrollBehavior', 'center');
    const ids: Record<string, number> = {};
    srBook('biscuit', 11, 0, 'recheck', 45, 'A', 'Ear recheck').then(({ id }) => (ids.biscuit = id));
    includeSeededDoctorsInProviderList();
    // Off camera: Juniper on the waitlist (Wellness, Next 2 weeks), nothing booked.
    signInAsScheduling('cl', '/schedule/scheduling-tools/waitlist');
    cy.contains('button', /^Add to waitlist$/, { timeout: 60000 }).first().click();
    cy.get('[role="dialog"] input').first().type('Rivera');
    cy.get('[role="dialog"]').contains(/Juniper|Rivera/, { timeout: 30000 }).first().click({ force: true });
    cy.contains('[role="dialog"] label', 'Juniper', { timeout: 30000 }).find('input[type=checkbox]').check();
    cy.contains('[role="dialog"] label', 'Maple').find('input[type=checkbox]').uncheck();
    cy.contains('[role="dialog"] label', 'Pepper').find('input[type=checkbox]').uncheck();
    cy.get('[role="dialog"] select').first().select('Wellness');
    cy.contains('[role="dialog"] *', 'Next 2 weeks').click({ force: true });
    cy.contains('[role="dialog"] button', /^Add to waitlist$/).click({ force: true });
    cy.contains('[role="dialog"]', 'Add to waitlist').should('not.exist');
    cy.contains('button', 'Recommend slot', { timeout: 30000 }).should('exist');
    // Then the Home calendar on Biscuit's day.
    const { ymd } = nextWeekdayNy(9);
    signInAsScheduling('cl', `/schedule/scheduler?fromMyDay=1&date=${ymd}&provider=${w.doctors.A}`);
    cy.get('[data-appt-id]', { timeout: 60000 }).should('have.length.at.least', 1);
    cy.contains('Loading drive times', { timeout: 60000 }).should('not.exist');
    cy.wait(1500);

    const card = (name: string) =>
      cy.contains(name).parents().filter((_, el) => el.innerText.includes('Recommend slot')).first();
    const record = () => {
      startClock();
      line('sr09-01', () => pointAt(() => cy.get(`[data-appt-id="${ids.biscuit}"]`).first(), 3000));
      line('sr09-02', () => {
        rightClickVisit(ids.biscuit);
        openMenuGroup('Scheduling');
        menuItem('Add to waitlist');
        cy.contains(/Client and pets are filled from the schedule visit/, { timeout: 30000 }).should('be.visible');
      });
      line('sr09-03', () => pointAt(() => cy.contains(/Client and pets are filled from the schedule visit/), 3000));
      line('sr09-04');
      line('sr09-05', () => tap(() => cy.get('[role="dialog"]').contains('button, label, [role="radio"]', /^ASAP/).first()));
      line('sr09-06', () => typeSlowly(() => cy.get('[role="dialog"] textarea').last(), 'Would like sooner; mornings best'));
      line('sr09-07', () => {
        cy.contains('[role="dialog"] button', /^Add to waitlist$/).scrollIntoView();
        tap(() => cy.contains('[role="dialog"] button', /^Add to waitlist$/));
        cy.contains(/Added Biscuit to the waitlist/, { timeout: 30000 }).should('exist');
      });
      line('sr09-08', () => pointAt(() => cy.contains(/Added Biscuit to the waitlist/), 2000));
      offCamera(() => {
        signInAsScheduling('cl', '/schedule/scheduling-tools/waitlist');
        cy.contains('Tom Chen', { timeout: 60000 }).should('exist');
        hideBanner();
        cy.wait(800);
      });
      line('sr09-09', () => pointAt(() => card('Tom Chen'), 5000));
      line('sr09-10', () => pointAt(() => cy.contains('Fill a cancellation').parent(), 5000));
      line('sr09-11', () => {
        tap(() => card('Maria Rivera').contains('button', 'Recommend slot'));
        cy.get('input[placeholder="Type doctor name..."]', { timeout: 30000 }).should('exist');
      });
      line('sr09-12', () => {
        typeSlowly(() => cy.get('input[placeholder="Type doctor name..."]'), 'Lane');
        tap(() => cy.contains('button, li, [role="option"]', 'Avery Lane'));
        cy.get('select').filter(':visible').then(($s) => {
          const sel = $s.filter((_, el) => (el as HTMLSelectElement).options[0]?.text === 'Select type…');
          if (sel.length) cy.wrap(sel.first()).select('Wellness');
        });
        tap(() => cy.contains('button', /^Get Best Route$/).last());
        cy.get('body').then(($b) => {
          if ($b.find('button:contains("Search anyway")').length) cy.contains('button', 'Search anyway').click();
        });
        cy.contains('button', 'View Placement', { timeout: 60000 }).should('exist');
      });
      line('sr09-13', () => {
        tap(() => cy.contains('button', 'View Placement').first());
        tap(() => cy.contains('button', /^Next$/));
        cy.contains('[role="dialog"] button', /^Text offer$/, { timeout: 30000 }).should('exist');
      });
      line('sr09-14', () => {
        cy.contains('[role="dialog"] button', /^Text offer$/).scrollIntoView();
        pointAt(() => cy.contains('[role="dialog"] button', /^Text offer$/), 2500);
        pointAt(() => cy.contains('[role="dialog"] button', /^Book/), 2500);
      });
      line('sr09-15');
      line('sr09-16');
      finish();
    };
    cy.then(() => record());
  });
});

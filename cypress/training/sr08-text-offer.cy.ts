/// <reference types="cypress" />
/**
 * Training video SR-08: Text a family an open slot
 * (docs/training/scripts/scheduling-routing/SR-08-text-an-open-slot.md).
 * TEST stack only. Off camera, Casey Morgan (CL) puts Juniper on the waitlist and picks a slot with Recommend slot.
 * On camera: Text offer, send (captured in sms.jsonl, never sent), Texted offers, the family's confirm page.
 */
import '../support/e2e';
import { includeSeededDoctorsInProviderList, signInAsScheduling } from '../support/schedulingWorld';
import { resetDemo } from './probes-sr/srKit';
import { hideNonProdBanner } from './srRecord';
import { finish, line, loadNarration, offCamera, pointAt, startClock, tap } from './trainingKit';

const dialog = () => cy.get('[role="dialog"]').filter(':visible').last();

function openTextedOffers() {
  // The Scheduling Tools tabs are on the page (Care outreach, Forward booking, Texted offers, …).
  tap(() => cy.contains('a, button, [role="tab"]', /^Texted offers/).filter(':visible').first());
  cy.contains(/Active/, { timeout: 60000 }).should('be.visible');
}

describe('Training: SR-08 text an open slot', () => {
  it('SR-08', () => {
    loadNarration();
    hideNonProdBanner();
    resetDemo();
    const db = String(Cypress.env('SCH_DB'));
    expect(db).to.match(/^vayd_api_test[A-Za-z0-9_]*$/);
    cy.exec(`psql -d ${db} -c "delete from slot_offers" -c "delete from waitlist_entries" `, { failOnNonZeroExit: false });
    Cypress.config('scrollBehavior', 'center');
    includeSeededDoctorsInProviderList();
    // Off camera: Juniper on the waitlist (Wellness, Next 2 weeks), then Recommend slot → a placement → Next.
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
    cy.contains('Juniper').parents().filter((_, el) => el.innerText.includes('Recommend slot')).first()
      .within(() => cy.contains('button', 'Recommend slot').click({ force: true }));
    cy.get('input[placeholder="Type doctor name..."]', { timeout: 30000 }).type('Lane');
    cy.contains('button, li', 'Avery Lane').click({ force: true });
    cy.get('select').filter(':visible').filter((_, el) => (el as HTMLSelectElement).options[0]?.text === 'Select type…').first().select('Wellness');
    cy.contains('button', /^Get Best Route$/).last().click();
    cy.wait(2000);
    cy.get('body').then(($b) => { if ($b.find('button:contains("Search anyway")').length) cy.contains('button', 'Search anyway').click(); });
    cy.contains('button', 'View Placement', { timeout: 60000 }).first().click();
    cy.contains('button', /^Next$/, { timeout: 30000 }).click();
    cy.contains('[role="dialog"] button', /^Text offer$/, { timeout: 30000 }).should('exist');
    cy.wait(1500);

    const record = () => {
      startClock();
      line('sr08-01');
      line('sr08-02', () => pointAt(() => dialog().contains(/slot is not held until they confirm/), 4500));
      line('sr08-03');
      line('sr08-04', () => {
        cy.contains('[role="dialog"] button', /^Text offer$/).scrollIntoView();
        tap(() => cy.contains('[role="dialog"] button', /^Text offer$/));
        cy.contains(/confirmation link is added automatically/i, { timeout: 30000 }).should('be.visible');
      });
      line('sr08-05', () => pointAt(() => cy.contains(/confirmation link is added automatically/i), 4000));
      line('sr08-06', () => pointAt(() => cy.contains(/Check before sending/i).parent(), 4000));
      line('sr08-07', () => {
        tap(() => dialog().contains('button', /^(Send|Send text|Send offer)/));
        cy.contains(/confirmation link is added automatically/i, { timeout: 30000 }).should('not.exist');
      });
      line('sr08-08', () => {
        cy.get('body').type('{esc}');
        openTextedOffers();
        pointAt(() => cy.contains('Juniper').first().parents('tr, [role="row"], li, div').first(), 4000);
      });
      // The family's page: the link from the captured text (training stack; nothing was really sent).
      // Load the family's page off camera (the blank page load is cut from the video).
      offCamera(() => {
        cy.readFile(String(Cypress.env('SCH_SMS_CAPTURE'))).then((raw: string) => {
          const links = String(raw).match(/https?:\/\/[^\s"\\]+\/confirm\/[A-Za-z0-9_-]+/g) || [];
          expect(links.length, 'confirm link in the captured text').to.be.greaterThan(0);
          cy.visit(links[links.length - 1].replace(/^https?:\/\/[^/]+/, ''));
        });
        cy.contains('button', /Confirm this time/, { timeout: 60000 }).should('be.visible');
        cy.wait(800);
      });
      line('sr08-09', () => pointAt(() => cy.contains('button', /Confirm this time/).parents('div').eq(1), 3500));
      line('sr08-10', () => {
        tap(() => cy.contains('button', /Confirm this time/));
        cy.contains(/You're all set/i, { timeout: 60000 }).should('be.visible');
      });
      line('sr08-11', () => pointAt(() => cy.contains(/You're all set/i), 3000));
      offCamera(() => {
        signInAsScheduling('cl', '/schedule/scheduling-tools/texted-offers');
        cy.contains(/Active/, { timeout: 60000 }).should('be.visible');
        cy.document().then((doc) => {
          const st = doc.createElement('style');
          st.textContent = '.app-nonprod-banner{display:none!important}.app-root--nonprod{--app-nonprod-banner-height:0px!important;padding-top:0!important}';
          doc.head.appendChild(st);
        });
        cy.wait(800);
      });
      line('sr08-12', () => {
        tap(() => cy.contains('button, [role="tab"]', /^To review/));
        pointAt(() => cy.contains('Juniper').first().parents('tr, [role="row"]').first(), 3500);
      });
      line('sr08-13');
      finish();
    };
    cy.then(() => record());
  });
});

/// <reference types="cypress" />
/**
 * Training video SR-06: Online requests, work the Appointments queue
 * (docs/training/scripts/scheduling-routing/SR-06-online-requests-queue.md).
 * TEST stack only. Off camera, Maria Rivera sends two requests from the client portal (Maple and Juniper); the
 * liaison email goes to the capture file. Casey Morgan (CL) books Maple's and marks Juniper's not booked.
 */
import '../support/e2e';
import { includeSeededDoctorsInProviderList, schedulingWorld, signInAsScheduling } from '../support/schedulingWorld';
import { resetDemo } from './probes-sr/srKit';
import { hideNonProdBanner } from './srRecord';
import { choose, finish, line, loadNarration, pointAt, startClock, tap, typeSlowly } from './trainingKit';

/** Maria asks for a visit from the client portal (manual scheduling, Flexible), as in probes-sr/sr06-queue. */
function portalRequest(pet: string, why: string, note: string) {
  cy.intercept('GET', '**/public/species-breeds?practiceId=1', { fixture: 'species-breeds.json' });
  cy.intercept('GET', '**/public/species-breeds?practiceId=1&speciesId=*', { fixture: 'breeds.json' });
  cy.intercept('POST', '**/public/appointments/form').as('submit');
  signInAsScheduling('client', '/client-portal/request-appointment');
  cy.get('input[type="tel"]', { timeout: 30000 }).should('not.have.value', '');
  cy.contains('Is this the place we are doing the visit?').parent().find('input[value="Yes"]').check();
  cy.contains('Is your mailing address the same as this location?').parent().find('input[type="radio"]').first().check();
  cy.contains('[data-pet-id]', pet).find('input[type="checkbox"]').first().check();
  cy.contains('[data-pet-id]', pet).find('[data-visit-reason="not-feeling-well"]').click();
  cy.get('textarea').first().type(why);
  cy.get('[data-how-soon="Flexible"]').click();
  cy.contains('Checking online scheduling options', { timeout: 40000 }).should('not.exist');
  if (note) cy.get('textarea[placeholder^="For example: mornings"]').type(note);
  cy.contains('button', /^Submit$/).click();
  cy.wait('@submit', { timeout: 90000 });
}

describe('Training: SR-06 online requests', () => {
  it('SR-06', () => {
    const w = schedulingWorld();
    loadNarration();
    hideNonProdBanner();
    resetDemo();
    // Clear earlier requests from the demo households (test database only).
    const db = String(Cypress.env('SCH_DB'));
    expect(db).to.match(/^vayd_api_test[A-Za-z0-9_]*$/);
    cy.exec(
      `psql -d ${db} -c "delete from appointment_request_submission where \\"requestData\\"->>'clientId' in ('${w.households.A.clientId}','${w.households.B.clientId}')"`
    );
    // The public form allows 3 submissions an hour per address. Clear those counters in this stack's own
    // Redis db (test stack only), so earlier takes don't block this one.
    cy.exec(`redis-cli -n ${Cypress.env('SCH_REDIS_DB') || 10} --scan --pattern 'throttle:*' | xargs -n 50 redis-cli -n ${Cypress.env('SCH_REDIS_DB') || 10} del`, { failOnNonZeroExit: false });
    Cypress.config('scrollBehavior', 'center');
    portalRequest('Juniper', 'Scratching her ears a lot', 'Any weekday afternoon');
    portalRequest('Maple', 'Limping on the left hind leg since yesterday', 'Mornings are best, not Wednesdays');
    includeSeededDoctorsInProviderList();
    signInAsScheduling('cl', '/schedule/appointments');
    cy.contains('.appt-request-row', 'Maple', { timeout: 60000 }).should('be.visible');
    cy.wait(2000);

    const row = (pet: string) => cy.contains('.appt-request-row', pet).first();
    /** The Text requester window: the nearest box around its title that holds the message. */
    const smsBox = () => cy.contains('Text requester').parentsUntil('body').filter((_, el) => !!el.querySelector('textarea')).first();
    const record = () => {
      startClock();
      line('sr06-01');
      line('sr06-02', () => pointAt(() => cy.contains('button, [role="tab"]', /^New/).first().parent(), 4500));
      line('sr06-03');
      line('sr06-04', () => pointAt(() => row('Maple'), 4000));
      line('sr06-05', () => pointAt(() => row('Maple').find('.appt-request-client-note-label').parent(), 3000));
      line('sr06-06', () => pointAt(() => row('Maple').contains('button, a', /View full request/), 2500));
      line('sr06-07', () => {
        tap(() => row('Maple').contains('button', /^Book$/));
        cy.contains('Appointment request from', { timeout: 30000 }).should('be.visible');
        cy.contains('Loading', { timeout: 60000 }).should('not.exist');
      });
      line('sr06-08', () => pointAt(() => cy.contains('Appointment request from').parent(), 4000));
      line('sr06-09', () => {
        typeSlowly(() => cy.get('input[placeholder="Type doctor name..."]'), 'Lane');
        tap(() => cy.contains('button, li, [role="option"]', 'Avery Lane'));
        tap(() => cy.contains('button', /^Get Best Route$/).last());
        cy.get('body').then(($b) => {
          if ($b.find('button:contains("Search anyway")').length) cy.contains('button', 'Search anyway').click();
        });
        cy.contains('button', 'View Placement', { timeout: 40000 }).should('exist');
      });
      // A morning that isn't a Wednesday: the first result card whose date line is a morning on another day.
      const morning = () =>
        cy.get('.routing-result-option-card').filter((_, el) => /(Mon|Tues|Thurs|Fri)day[^@]*@ (8|9|10|11):\d\d AM/.test(el.innerText)).first();
      line('sr06-10', () => {
        tap(() => morning().contains('button', 'View Placement'));
        cy.get('.scheduler-edit-preview-popover-change', { timeout: 30000 }).should('be.visible');
      });
      line('sr06-11', () => {
        tap(() => cy.contains('button', /^Book$/));
        cy.contains('[role="dialog"] button', 'Book appointment', { timeout: 30000 }).should('exist');
      });
      line('sr06-12', () => pointAt(() => cy.get('[role="dialog"]').contains('Maple').first().parents('div').eq(1), 3500));
      line('sr06-13', () => {
        cy.contains('[role="dialog"] button', 'Book appointment').scrollIntoView();
        tap(() => cy.contains('[role="dialog"] button', 'Book appointment'));
        // Booking from a request returns to Appointments and opens a text to the family.
        cy.contains('Text requester', { timeout: 60000 }).should('be.visible');
      });
      line('sr06-14', () => pointAt(() => smsBox().find('textarea').first(), 5000));
      line('sr06-14a', () => {
        pointAt(() => cy.contains('button', /^Send message$/), 2000);
        // Training only: don't send. Cancel closes it.
        tap(() => smsBox().contains('button', /^Cancel$/));
        tap(() => cy.contains('button', /^Don't send$/));
        cy.contains('Text requester').should('not.exist');
        cy.contains('.appt-request-row', 'Juniper', { timeout: 60000 }).should('be.visible');
      });
      line('sr06-15', () => pointAt(() => cy.contains('button, [role="tab"]', /^New/).first(), 3000));
      line('sr06-15b', () =>
        pointAt(
          () =>
            cy
              .get('body *')
              .filter((_, el) => el.children.length === 0 && el.textContent?.trim() === 'Scheduling')
              .filter((_, el) => {
                const r = el.getBoundingClientRect();
                return r.width > 0 && r.top >= 0 && r.top < 160;
              })
              .first(),
          4000
        )
      );
      line('sr06-16', () => {
        tap(() => row('Juniper').contains('button', /^Not booked$/));
        cy.contains('Mark as not booked', { timeout: 20000 }).should('be.visible');
      });
      line('sr06-17', () => choose(() => cy.get('#appt-request-not-booked-title').parent().find('select').first(), 'Not ready to schedule'));
      line('sr06-18', () => {
        tap(() => cy.contains('button', /^Mark not booked$/));
        cy.contains('Mark as not booked').should('not.exist');
      });
      line('sr06-19', () => pointAt(() => cy.contains('button, [role="tab"]', /^Contacted/).first(), 3000));
      line('sr06-20');
      finish();
    };
    cy.then(() => record());
  });
});

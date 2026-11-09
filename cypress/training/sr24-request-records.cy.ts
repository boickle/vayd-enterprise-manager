/// <reference types="cypress" />
/**
 * Training video SR-24: Request records from the previous vet
 * (docs/training/scripts/scheduling-routing/SR-24-request-records.md).
 * TEST stack only. Biscuit Chen is booked with Dr. Lane. Casey Morgan (CL) asks Maplewood Animal Hospital (one-off,
 * a .example address) for records. The email is captured / redirected on the test stack.
 */
import '../support/e2e';
import { includeSeededDoctorsInProviderList, schedulingWorld, signInAsScheduling } from '../support/schedulingWorld';
import { resetDemo, srBook } from './probes-sr/srKit';
import { hideNonProdBanner, menuItem, openMenuGroup, rightClickVisit } from './srRecord';
import { finish, line, loadNarration, pointAt, startClock, tap, typeSlowly } from './trainingKit';

describe('Training: SR-24 request records', () => {
  it('SR-24', () => {
    const w = schedulingWorld();
    loadNarration();
    hideNonProdBanner();
    resetDemo();
    const db = String(Cypress.env('SCH_DB'));
    expect(db).to.match(/^vayd_api_test[A-Za-z0-9_]*$/);
    cy.exec(`psql -d ${db} -c "delete from records_request where \\"clientId\\" in (${w.households.A.clientId},${w.households.B.clientId})"`);
    let id = 0;
    let ymd = '';
    srBook('biscuit', 11, 0, 'recheck', 45, 'A', 'Ear recheck').then((r) => { id = r.id; ymd = r.ymd; });
    Cypress.config('scrollBehavior', 'center');
    includeSeededDoctorsInProviderList();
    cy.then(() => signInAsScheduling('cl', `/schedule/scheduler?fromMyDay=1&date=${ymd}&provider=${w.doctors.A}`));
    cy.get('[data-appt-id]', { timeout: 60000 }).should('have.length.at.least', 1);
    cy.contains('Loading drive times', { timeout: 60000 }).should('not.exist');
    cy.wait(1500);

    const record = () => {
      startClock();
      line('sr24-01');
      line('sr24-02', () => pointAt(() => cy.get(`[data-appt-id="${id}"]`).first(), 3500));
      line('sr24-03');
      line('sr24-04', () => {
        rightClickVisit(id);
        openMenuGroup('Visit Prep');
        menuItem(/^Request records/i);
        cy.get('input[placeholder="Name of the practice"]', { timeout: 30000 }).should('exist');
      });
      line('sr24-05', () => pointAt(() => cy.get('input[placeholder^="Search hospitals"]').first(), 3000));
      line('sr24-06', () => {
        typeSlowly(() => cy.get('input[placeholder="Name of the practice"]'), 'Maplewood Animal Hospital');
        typeSlowly(() => cy.get('input[placeholder="records@example.com"]'), 'records@maplewood-vet.example');
      });
      line('sr24-07', () => {
        tap(() => cy.contains('Client has authorized us'));
        cy.contains('Client has authorized us').parent().find('input[type="checkbox"]').then(($c) => {
          if (!($c[0] as HTMLInputElement).checked) cy.wrap($c).check({ force: true });
        });
      });
      line('sr24-08', () => {
        tap(() => cy.contains('button', /Send 1 request/));
        cy.contains(/Emailed 1 hospital/, { timeout: 30000 }).should('exist');
      });
      line('sr24-09', () => {
        pointAt(() => cy.contains(/Already asked/i).parent(), 3500);
        tap(() => cy.contains('button', /Done\s*$/));
      });
      line('sr24-10', () => pointAt(() => cy.get(`[data-appt-id="${id}"]`).first().contains(/^RR$/), 3500));
      line('sr24-11');
      line('sr24-12');
      finish();
    };
    cy.then(() => record());
  });
});

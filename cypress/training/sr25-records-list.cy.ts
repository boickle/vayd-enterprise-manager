/// <reference types="cypress" />
/**
 * Training video SR-25: The Records list, chase what's late
 * (docs/training/scripts/scheduling-routing/SR-25-records-list.md).
 * TEST stack only. Off camera, Casey Morgan (CL) requests Biscuit's records from Maplewood Animal Hospital (one-off,
 * a .example address; the email is captured / redirected on the test stack). Then the Records list.
 */
import '../support/e2e';
import { includeSeededDoctorsInProviderList, schedulingWorld, signInAsScheduling } from '../support/schedulingWorld';
import { resetDemo, srBook } from './probes-sr/srKit';
import { hideNonProdBanner, menuItem, openMenuGroup, rightClickVisit } from './srRecord';
import { finish, line, loadNarration, pointAt, startClock } from './trainingKit';

describe('Training: SR-25 records list', () => {
  it('SR-25', () => {
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
    cy.then(() => {
      rightClickVisit(id);
      openMenuGroup('Visit Prep');
      menuItem(/^Request records/i);
    });
    cy.get('input[placeholder="Name of the practice"]', { timeout: 30000 }).type('Maplewood Animal Hospital');
    cy.get('input[placeholder="records@example.com"]').type('records@maplewood-vet.example');
    cy.contains('Client has authorized us').parent().find('input[type="checkbox"]').check({ force: true });
    cy.contains('button', /Send 1 request/).click();
    cy.contains(/Emailed 1 hospital/, { timeout: 30000 }).should('exist');
    cy.contains('button', /Done\s*$/).click();
    signInAsScheduling('cl', '/schedule/scheduling-tools/records');
    cy.contains('Maplewood Animal Hospital', { timeout: 60000 }).should('exist');
    cy.wait(1500);

    const row = () => cy.contains('Maplewood Animal Hospital').parents('tr, [role="row"]').first();
    const record = () => {
      startClock();
      line('sr25-01');
      line('sr25-02', () => pointAt(() => cy.contains('button, [role="tab"]', /^Visit is close/).first().parent(), 4500));
      line('sr25-03', () => pointAt(() => cy.contains(/still open with the visit/i).first(), 3500));
      line('sr25-04', () => pointAt(() => row(), 4500));
      line('sr25-05', () => pointAt(() => cy.contains('button', /Resend/).first(), 3000));
      line('sr25-06');
      line('sr25-07', () => pointAt(() => row().contains('button', /^Received/), 3000));
      line('sr25-08', () => pointAt(() => row().contains('button', /^Cancel/), 2500));
      line('sr25-09');
      finish();
    };
    cy.then(() => record());
  });
});

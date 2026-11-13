/// <reference types="cypress" />
/**
 * Training video SR-26: File a received record and check the summary
 * (docs/training/scripts/scheduling-routing/SR-26-file-a-record-and-check-the-summary.md).
 * TEST stack only, fictional record (cypress/training/setup/maplewood-biscuit-records.pdf). Off camera, Casey Morgan
 * (CL) requests Biscuit's records from Maplewood. On camera she files the PDF, reviews Scout's draft and enters it.
 */
import '../support/e2e';
import { includeSeededDoctorsInProviderList, schedulingWorld, signInAsScheduling } from '../support/schedulingWorld';
import { resetDemo, srBook } from './probes-sr/srKit';
import { hideNonProdBanner, menuItem, openMenuGroup, rightClickVisit } from './srRecord';
import { finish, line, loadNarration, pointAt, startClock, tap } from './trainingKit';

const PDF = 'cypress/training/setup/maplewood-biscuit-records.pdf';

describe('Training: SR-26 file a record', () => {
  it('SR-26', () => {
    const w = schedulingWorld();
    loadNarration();
    hideNonProdBanner();
    resetDemo();
    const db = String(Cypress.env('SCH_DB'));
    expect(db).to.match(/^vayd_api_test[A-Za-z0-9_]*$/);
    cy.exec(`psql -d ${db} -c "delete from records_request where \\"clientId\\" in (${w.households.A.clientId},${w.households.B.clientId})"`);
    // Earlier takes entered Biscuit's reminders and summary; Scout skips reminders already on the chart. Clear them (test DB).
    cy.exec(
      `psql -d ${db} -c "delete from reminders where \\"patientId\\"=${w.households.B.petId}" ` +
        `-c "delete from scout_chart_notes where \\"patientId\\"=${w.households.B.petId} and kind='previous_records'"`,
      { failOnNonZeroExit: false }
    );
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
    signInAsScheduling('cl', '/schedule/scheduling-tools/records');
    cy.contains('Maplewood Animal Hospital', { timeout: 60000 }).should('exist');
    cy.wait(1500);

    const row = () => cy.contains('Maplewood Animal Hospital').parents('tr, [role="row"]').first();
    const record = () => {
      startClock();
      line('sr26-01');
      line('sr26-02', () => pointAt(() => row(), 3500));
      line('sr26-03');
      line('sr26-04', () => {
        cy.get('body').then(($b) => {
          const btn = $b.find('[title="File a document you received"], [aria-label="File a document you received"]');
          if (btn.length) pointAt(() => cy.wrap(btn.first()), 1500);
        });
        cy.get('input[type="file"]').first().selectFile(PDF, { force: true });
        cy.contains(/Filed .*maplewood-biscuit-records\.pdf/i, { timeout: 60000 }).should('exist');
      });
      line('sr26-05', () => pointAt(() => cy.contains(/Filed .*maplewood-biscuit-records\.pdf/i).first(), 4000));
      line('sr26-06', () => {
        tap(() => cy.contains('button, [role="tab"]', /^Received/).first());
        tap(() => cy.contains('button', /Review & summarize/).first());
        cy.contains('button', 'Save & summarize records', { timeout: 60000 }).should('exist');
      });
      line('sr26-07', () => {
        pointAt(() => cy.contains(/maplewood-biscuit-records/i).first(), 2500);
        tap(() => cy.contains('button', 'Save & summarize records'));
      });
      line('sr26-08', () => cy.contains(/Review previous records/i, { timeout: 180000 }).should('exist'));
      line('sr26-09', () => pointAt(() => cy.contains(/Check the summary and reminders against the documents/i).first(), 3500));
      line('sr26-10', () => {
        cy.get('body').then(($b) => {
          const tab = $b.find('button:contains("Reminders"), [role="tab"]:contains("Reminders")');
          if (tab.length) tap(() => cy.wrap(tab.first()));
        });
        pointAt(() => cy.contains(/Add the checked reminders to the chart/i).parent(), 3000);
        // Dental cleaning's due date comes back as last year; fix it (the record says within 12 months of April 2025).
        cy.get('body').then(($b) => {
          const d = $b.find('input[type="date"]').filter((_, el) => /^2025-04/.test((el as HTMLInputElement).value)).first();
          if (d.length) {
            pointAt(() => cy.wrap(d), 1500);
            cy.wrap(d).clear().type('2026-04-02');
          }
        });
      });
      line('sr26-11', () => {
        tap(() => cy.contains('button', /Review Summary First/));
        cy.get('body').then(($b) => {
          const caution = $b.find(':contains("snap"), :contains("Snap"), :contains("caution"), :contains("Caution")').filter((_, el) => el.children.length === 0);
          if (caution.length) pointAt(() => cy.wrap(caution.first()), 4000);
          else pointAt(() => cy.contains(/Previous Medical Records/i).first(), 4000);
        });
      });
      line('sr26-12', () => {
        tap(() => cy.contains('button', /Enter Reminders & Summary in Record/).first());
        cy.contains(/Enter in medical record\?/i, { timeout: 30000 }).should('be.visible');
      });
      line('sr26-13', () => {
        pointAt(() => cy.contains(/Reminders show under Upcoming and on the client portal/i).first(), 4000);
        tap(() => cy.contains(/Enter in medical record\?/i).parents().filter((_, el) => !!el.querySelector('button')).first().contains('button', /Enter Reminders & Summary in Record/));
        cy.contains(/Enter in medical record\?/i, { timeout: 60000 }).should('not.exist');
      });
      line('sr26-14');
      finish();
    };
    cy.then(() => record());
  });
});

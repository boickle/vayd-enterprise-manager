/// <reference types="cypress" />
/**
 * Training video SR-12: Care outreach, families due for care
 * (docs/training/scripts/scheduling-routing/SR-12-care-outreach.md).
 * TEST stack only. Biscuit Chen has "Annual wellness exam" due 5 days ago and nothing booked (inserted in the test DB).
 */
import '../support/e2e';
import { includeSeededDoctorsInProviderList, schedulingWorld, signInAsScheduling } from '../support/schedulingWorld';
import { resetDemo } from './probes-sr/srKit';
import { hideNonProdBanner } from './srRecord';
import { choose, finish, line, loadNarration, pointAt, startClock, tap, typeSlowly } from './trainingKit';

describe('Training: SR-12 care outreach', () => {
  it('SR-12', () => {
    const w = schedulingWorld();
    loadNarration();
    hideNonProdBanner();
    resetDemo();
    const db = String(Cypress.env('SCH_DB'));
    expect(db).to.match(/^vayd_api_test[A-Za-z0-9_]*$/);
    const pets = [...w.households.A.activePetIds, w.households.B.petId].join(',');
    cy.exec(
      `psql -d ${db} -c "delete from reminders where \\"patientId\\" in (${pets})" ` +
        `-c "insert into reminders (description, \\"dueDate\\", \\"isActive\\", \\"isDeleted\\", \\"isSatisfied\\", \\"practiceId\\", \\"patientId\\", \\"employeeId\\") ` +
        `values ('Annual wellness exam', now() - interval '5 days', true, false, false, ${w.practiceId}, ${w.households.B.petId}, ${w.doctors.A})"`
    );
    Cypress.config('scrollBehavior', 'center');
    includeSeededDoctorsInProviderList();
    signInAsScheduling('cl', '/schedule/scheduling-tools/care-outreach');
    cy.contains(/^Past due last 30 days/, { timeout: 60000 }).should('exist');
    cy.wait(2000);

    const famRow = () => cy.contains('Tom Chen').parents().filter((_, el) => /Route/.test(el.innerText) && /Annual wellness/i.test(el.innerText)).first();
    const record = () => {
      startClock();
      line('sr12-01', () => pointAt(() => cy.contains(/Daily priorities/i).first().parent(), 4000));
      line('sr12-02');
      line('sr12-03', () => {
        tap(() => cy.contains('button, a, label, div', /^Past due last 30 days/).first());
        cy.contains('Tom Chen', { timeout: 30000 }).should('exist');
      });
      line('sr12-04', () => pointAt(() => famRow(), 5000));
      line('sr12-05', () => pointAt(() => famRow().contains(/Contact log/i).first(), 3000));
      line('sr12-06', () => {
        tap(() => famRow().contains('button', /^Route/));
        cy.contains('button', /^Get Best Route$/, { timeout: 60000 }).should('exist');
        pointAt(() => cy.contains(/Care outreach follow-up/i).first(), 2500);
      });
      line('sr12-07', () => {
        cy.get('body').then(($b) => {
          const doc = $b.find('input[placeholder="Type doctor name..."]');
          if (doc.length && !(doc[0] as HTMLInputElement).value) typeSlowly(() => cy.get('input[placeholder="Type doctor name..."]'), 'Lane');
        });
        cy.get('body').then(($b) => {
          if ($b.find('button:contains("Avery Lane"), li:contains("Avery Lane")').filter(':visible').length)
            tap(() => cy.contains('button, li, [role="option"]', 'Avery Lane'));
        });
        choose(
          () => cy.get('select').filter(':visible').filter((_, el) => Array.from((el as HTMLSelectElement).options).some((o) => o.text === 'Wellness')).first(),
          'Wellness'
        );
        tap(() => cy.contains('button', /^Get Best Route$/).last());
        cy.get('body').then(($b) => {
          if ($b.find('button:contains("Search anyway")').length) cy.contains('button', 'Search anyway').click();
        });
        cy.contains('button', 'View Placement', { timeout: 60000 }).should('exist');
        tap(() => cy.contains('button', 'View Placement').first());
        tap(() => cy.contains('button', /^(Next|Book)$/).filter(':visible').first());
        cy.contains('[role="dialog"] button', /^Text offer$/, { timeout: 30000 }).should('exist');
      });
      line('sr12-08', () => {
        cy.contains('[role="dialog"] button', /^Text offer$/).scrollIntoView();
        pointAt(() => cy.contains('[role="dialog"] button', /^Text offer$/), 2500);
        pointAt(() => cy.contains('[role="dialog"] button', /^Book/), 2500);
      });
      line('sr12-09');
      finish();
    };
    cy.then(() => record());
  });
});

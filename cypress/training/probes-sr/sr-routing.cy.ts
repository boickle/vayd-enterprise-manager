/// <reference types="cypress" />
/** Probe (no voice) for SR-03 and SR-05: Get Best Route from + Appointment and from Reschedule. */
import '../../support/e2e';
import { includeSeededDoctorsInProviderList, signInAsScheduling } from '../../support/schedulingWorld';
import { demoDay, dump, menuPick, openDemoDay, srBook } from './srKit';

describe('SR routing', () => {
  beforeEach(() => demoDay());

  it('reschedule: run the search and see results', () => {
    srBook('maple', 15, 0, 'recheck', 30, 'A', 'Probe visit').then(({ id }) => {
      openDemoDay('cl');
      menuPick(id, 'Scheduling', 'Reschedule');
      cy.contains('button', 'Get Best Route', { timeout: 20000 }).should('be.visible');
      dump('sr05-reschedule-form', 'body');
      cy.contains('button', /^Get Best Route$/).last().click();
      cy.wait(1500);
      cy.get('body').then(($b) => {
        if ($b.find('button:contains("Search anyway")').length) cy.contains('button', 'Search anyway').click();
      });
      cy.wait(10000);
      dump('sr05-reschedule-results', 'body');
      cy.contains('button', 'View Placement').first().click();
      cy.wait(4000);
      dump('sr05-view-placement', 'body');
      cy.screenshot('sr05-view-placement', { capture: 'viewport' });
      cy.contains('button', /^Reschedule$/).click();
      cy.wait(4000);
      dump('sr05-reschedule-modal');
      cy.screenshot('sr05-after-reschedule', { capture: 'viewport' });
      const w = Cypress.env('SCHEDULING_WORLD');
      const world = typeof w === 'string' ? JSON.parse(w) : w;
      const start = new Date(Date.now() - 864e5).toISOString();
      const end = new Date(Date.now() + 14 * 864e5).toISOString();
      cy.request({
        url: `${Cypress.env('API_URL')}/appointments/range?practiceId=${world.practiceId}&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&primaryProviderId=${world.doctors.A}`,
        headers: { Authorization: world.auth.cl.Authorization },
      }).then((r) => {
        const rows = (Array.isArray(r.body) ? r.body : r.body.items).map((a: any) => ({
          id: a.id, pet: a.patient?.name ?? a.patientName, start: a.appointmentStart, desc: a.description,
          status: a.confirmStatusName, deleted: a.isDeleted,
        }));
        cy.writeFile('cypress/training-out/probe-text/sr05-visits-after.json', JSON.stringify({ moved: id, rows }, null, 1));
      });
    });
  });

  it('+ Appointment: new booking for the Chens', () => {
    includeSeededDoctorsInProviderList();
    signInAsScheduling('cl', '/schedule/routing');
    cy.contains('button', 'Get Best Route', { timeout: 30000 }).should('be.visible');
    cy.wait(1500);
    dump('sr03-form-empty', 'body');
    cy.screenshot('sr03-form-empty', { capture: 'viewport' });
  });
});

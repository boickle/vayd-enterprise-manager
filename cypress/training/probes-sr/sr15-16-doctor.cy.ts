/// <reference types="cypress" />
/** Probe for SR-15 and SR-16: My Day, My Week, On My Way text, Start / End Visit (as Dr. Lane). */
import '../../support/e2e';
import { includeSeededDoctorsInProviderList, signInAsScheduling } from '../../support/schedulingWorld';
import { nextWeekdayNy } from '../../support/schedulingRemove';
import { dump, menuPick, openDemoDay, resetDemo, srBook } from './srKit';
const signInAsSchedulingDay = (ymd: string, doc: number) => { includeSeededDoctorsInProviderList(); signInAsScheduling('doctorA', `/schedule/scheduler?fromMyDay=1&date=${ymd}&provider=${doc}`); cy.get('[data-appt-id]', { timeout: 30000 }); cy.wait(1000); };

describe('SR-15/16 doctor', () => {
  let maple = 0;
  before(() => {
    return;
    resetDemo();
    srBook('maple', 9, 0, 'medical', 60, 'A', 'Limping on the left hind leg').then(({ id }) => (maple = id));
    srBook('biscuit', 11, 0, 'recheck', 45, 'A', 'Ear recheck');
    srBook('juniper', 13, 30, 'wellness', 60, 'A', 'Annual wellness');
  });
  it('My Day', () => {
    const { ymd } = nextWeekdayNy(9);
    includeSeededDoctorsInProviderList();
    signInAsScheduling('doctorA', `/schedule/my-day`);
    cy.wait(5000);
    dump('sr15-my-day', 'body');
    cy.screenshot('sr15-my-day', { capture: 'viewport' });
  });
  it('My Week', () => {
    includeSeededDoctorsInProviderList();
    signInAsScheduling('doctorA', `/schedule/my-week`);
    cy.wait(5000);
    cy.get('body').then(($b) => {
      if ($b.find('button[aria-label="Next week"]').length && !$b.text().includes('Maple')) cy.get('button[aria-label="Next week"]').click();
    });
    cy.wait(3000);
    dump('sr15-my-week', 'body');
    cy.screenshot('sr15-my-week', { capture: 'viewport' });
  });
  it.skip('On My Way and Start / End Visit', () => {
    openDemoDay('doctorA');
    menuPick(maple, 'On Visit Day', 'Send On My Way Text');
    cy.wait(2000);
    dump('sr16-omw-modal');
    cy.screenshot('sr16-omw-modal', { capture: 'viewport' });
    cy.get('body').type('{esc}');
    const w = (() => { const r = Cypress.env('SCHEDULING_WORLD'); return typeof r === 'string' ? JSON.parse(r) : r; })();
    const start = new Date(Date.now() + 60 * 60_000);
    start.setMinutes(0, 0, 0);
    cy.request({
      method: 'POST', url: `${Cypress.env('API_URL')}/appointments`, headers: { Authorization: w.auth.cl.Authorization },
      body: { practiceId: w.practiceId, primaryProviderId: w.doctors.A, clientId: w.households.B.clientId, patientId: w.households.B.petId,
        appointmentTypeId: w.types.recheck, appointmentStart: start.toISOString(), appointmentEnd: new Date(start.getTime() + 45 * 60_000).toISOString(),
        description: 'Ear recheck (today)', bookedViaRouting: true },
      failOnStatusCode: false,
    }).then((r) => {
      cy.writeFile('cypress/training-out/probe-text/sr16-today-book.txt', `${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
      const id = r.body.id;
      const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
      signInAsSchedulingDay(ymd, w.doctors.A);
      menuPick(id, 'On Visit Day', 'Start / End Visit');
    });
    cy.wait(2500);
    dump('sr16-start-end');
    cy.screenshot('sr16-start-end', { capture: 'viewport' });
  });
});

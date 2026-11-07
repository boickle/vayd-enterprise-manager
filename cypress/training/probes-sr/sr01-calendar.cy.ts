/// <reference types="cypress" />
/** SR-01 probe (no voice): the calendar, a visit's details and the right-click menu, as CL, doctor and tech. */
import '../../support/e2e';
import { includeSeededDoctorsInProviderList, schedulingApi, schedulingWorld, signInAsScheduling } from '../../support/schedulingWorld';
import { nextWeekdayNy } from '../../support/schedulingRemove';
import { demoDay, srBook } from './srKit';

describe('SR-01 calendar', () => {
  it('books the demo day', () => {
    demoDay();
  });

  for (const role of ['cl', 'doctorA', 'technician'] as const) {
    it(`calendar and menu as ${role}`, () => {
      const w = schedulingWorld();
      const { ymd } = nextWeekdayNy(9);
      includeSeededDoctorsInProviderList();
      signInAsScheduling(role, `/schedule/scheduler?fromMyDay=1&date=${ymd}&provider=${w.doctors.A}`);
      cy.get('[data-appt-id]', { timeout: 30000 }).should('have.length.at.least', 3);
      cy.wait(1500);
      cy.screenshot(`sr01-${role}-calendar`, { capture: 'viewport' });
      cy.get('[data-appt-id]').first().rightclick();
      for (const g of ['Scheduling', 'Visit Prep', 'On Visit Day', 'Patient', 'Client']) {
        cy.get('body').then(($b) => {
          const row = $b.find('.scheduler-ctx-parent-wrap').filter((_, el) => el.innerText.trim().startsWith(g));
          if (!row.length) {
            cy.log(`no group ${g}`);
            return;
          }
          cy.wrap(row.first()).trigger('mouseover');
          cy.wait(300);
          cy.screenshot(`sr01-${role}-menu-${g.replace(/\W+/g, '')}`, { capture: 'viewport' });
        });
      }
      cy.get('body').type('{esc}');
      cy.get('[data-appt-id]').first().click();
      cy.wait(1200);
      cy.screenshot(`sr01-${role}-visit-click`, { capture: 'viewport' });
    });
  }
});

export { srBook, schedulingApi };

/// <reference types="cypress" />
import '../../support/e2e';
import { includeSeededDoctorsInProviderList, signInAsScheduling } from '../../support/schedulingWorld';
import { dump, resetDemo, srBook } from './srKit';
import { nextWeekdayNy } from '../../support/schedulingRemove';
import { menuItem, openMenuGroup, rightClickVisit } from '../srRecord';

describe('SR-11 convert probe', () => {
  it('open / convert, then edit', () => {
    resetDemo();
    let id = 0;
    srBook('biscuit', 14, 0, 'hold', 45, 'A', 'Hold: new kitten exam, owner to confirm').then((r) => (id = r.id));
    includeSeededDoctorsInProviderList();
    const { ymd } = nextWeekdayNy(9);
    signInAsScheduling('cl', `/schedule/scheduler?fromMyDay=1&date=${ymd}`);
    cy.get('[data-appt-id]', { timeout: 60000 }).should('exist');
    cy.wait(3000);
    cy.then(() => { rightClickVisit(id); openMenuGroup('Scheduling'); });
    cy.screenshot('sr11-menu', { capture: 'viewport' });
    cy.then(() => menuItem('Edit Appointment'));
    cy.wait(3000);
    cy.get('select').filter(':visible').filter((_, el) => (el as HTMLSelectElement).selectedOptions[0]?.text === 'HOLD').first().select('Wellness');
    cy.contains('button', /^Preview schedule$/).click();
    cy.wait(5000);
    dump('sr11-preview', 'body');
    cy.screenshot('sr11-preview', { capture: 'viewport' });
  });
});

/// <reference types="cypress" />
/** Probe for SR-09 and SR-08: add to waitlist, fill a cancellation, text offer. */
import '../../support/e2e';
import { signInAsScheduling, includeSeededDoctorsInProviderList } from '../../support/schedulingWorld';
import { dump, menuPick, openDemoDay, resetDemo, srBook } from './srKit';

describe('SR-09 waitlist', () => {
  it('add Biscuit to the waitlist', () => {
    resetDemo();
    srBook('maple', 9, 0, 'medical', 60, 'A', 'Limping on the left hind leg');
    srBook('biscuit', 15, 0, 'recheck', 45, 'A', 'Ear recheck').then(({ id }) => {
      cy.wrap(id).as('biscuit');
      // Biscuit's visit is with Dr. Shah; open her calendar.
      const w = (() => { const r = Cypress.env('SCHEDULING_WORLD'); return typeof r === 'string' ? JSON.parse(r) : r; })();
      includeSeededDoctorsInProviderList();
      const { ymd } = { ymd: '' };
      openDemoDay('cl');
      menuPick(id, 'Scheduling', 'Add to waitlist');
      cy.wait(2500);
      dump('sr09-add-form', 'body');
      cy.screenshot('sr09-add-form', { capture: 'viewport' });
      cy.contains('ASAP').click();
      cy.get('textarea').last().type('Would like sooner; mornings best');
      cy.contains('button', /^Add to waitlist$/).click();
      cy.wait(2500);
      dump('sr09-after-add', 'body');
    });
  });
  it('waitlist page', () => {
    includeSeededDoctorsInProviderList();
    signInAsScheduling('cl', '/schedule/scheduling-tools/waitlist');
    cy.wait(5000);
    dump('sr09-waitlist-page', 'body');
    cy.screenshot('sr09-waitlist-page', { capture: 'viewport' });
    cy.contains('Fill a cancellation').scrollIntoView();
    cy.get('input[placeholder="Search doctor…"]').type('Lane');
    cy.wait(1000);
    cy.contains('button, li, [role="option"]', 'Avery Lane').first().click({ force: true });
    cy.wait(3000);
    dump('sr09-fill', 'body');
    cy.screenshot('sr09-fill', { capture: 'viewport' });
  });
});

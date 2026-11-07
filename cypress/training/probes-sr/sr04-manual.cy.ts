/// <reference types="cypress" />
/** Probe for SR-04: book by hand on the calendar (double-click an empty slot). */
import '../../support/e2e';
import { dump, openDemoDay, resetDemo, srBook } from './srKit';

const dbl = () => cy.get('.scheduler-day-body:not(.scheduler-day-body--off)').eq(1).dblclick(120, 260, { force: true });

describe('SR-04 manual book', () => {
  beforeEach(() => {
    resetDemo();
    srBook('maple', 9, 0, 'medical', 60, 'A', 'Limping on the left hind leg');
  });
  it('CL books the Chens by hand', () => {
    openDemoDay('cl');
    dbl();
    cy.wait(2000);
    dump('sr04-modal-empty');
    cy.screenshot('sr04-modal-empty', { capture: 'viewport' });
    cy.get('[role="dialog"] select').eq(1).select('Recheck');
    cy.wait(1500);
    dump('sr04-after-type');
    cy.get('[role="dialog"] input[placeholder^="Pet name, client name"]').type('Chen');
    cy.wait(2500);
    dump('sr04-search');
    cy.get('[role="dialog"]').contains(/Biscuit/).first().click({ force: true });
    cy.wait(2500);
    dump('sr04-filled');
    cy.screenshot('sr04-filled', { capture: 'viewport' });
    cy.contains('[role="dialog"] button', 'Preview on calendar').click();
    cy.wait(2500);
    dump('sr04-preview', 'body');
    cy.screenshot('sr04-preview', { capture: 'viewport' });
    cy.contains('button', /^Book$/, { timeout: 20000 }).should('not.be.disabled').click();
    cy.wait(3000);
    dump('sr04-after-book', 'body');
    cy.screenshot('sr04-after-book', { capture: 'viewport' });
  });
  for (const role of [] as const) {
    it(`${role} double-clicks Dr. Lane's calendar`, () => {
      openDemoDay(role);
      dbl();
      cy.wait(2000);
      dump(`sr04-${role}`, 'body');
    });
  }
});

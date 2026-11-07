/// <reference types="cypress" />
/** Probe for SR-15: a doctor's day on the calendar (Day view, Maps, My Day PDF). */
import '../../support/e2e';
import { dump, openDemoDay, resetDemo, srBook } from './srKit';

describe('SR-15 doctor day', () => {
  it('Day view, Maps, PDF', () => {
    resetDemo();
    srBook('maple', 9, 0, 'medical', 60, 'A', 'Limping on the left hind leg');
    srBook('biscuit', 11, 0, 'recheck', 45, 'A', 'Ear recheck');
    srBook('juniper', 13, 30, 'wellness', 60, 'A', 'Annual wellness');
    openDemoDay('doctorA');
    cy.window().then((win) => cy.stub(win, 'open').as('open'));
    cy.contains('button', /^Day$/).click();
    cy.wait(3000);
    dump('sr15-day-view', 'body');
    cy.screenshot('sr15-day-view', { capture: 'viewport' });
    cy.contains('button', /^Maps$/).first().click({ force: true });
    cy.wait(2500);
    cy.get('@open').then((s: any) => cy.writeFile('cypress/training-out/probe-text/sr15-maps.txt', JSON.stringify(s.args ?? [])));
    dump('sr15-after-maps', 'body');
  });
});

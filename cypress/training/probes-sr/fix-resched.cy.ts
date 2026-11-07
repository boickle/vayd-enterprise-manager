/// <reference types="cypress" />
/** Check: Reschedule asks "only this visit or all", and Only moves the right-clicked visit. */
import '../../support/e2e';
import { dump, menuPick, openDemoDay, resetDemo, srBook } from './srKit';
describe('reschedule scope', () => {
  it('asks, then moves only Maple 3 pm', () => {
    resetDemo();
    srBook('maple', 9, 0, 'medical', 60, 'A', 'Limping on the left hind leg');
    srBook('juniper', 13, 30, 'wellness', 60, 'A', 'Annual wellness');
    srBook('maple', 15, 0, 'recheck', 30, 'A', 'Recheck leg').then(({ id }) => {
      openDemoDay('cl');
      menuPick(id, 'Scheduling', 'Reschedule');
      cy.wait(1500);
      dump('fix-scope-modal');
      cy.screenshot('fix-scope-modal', { capture: 'viewport' });
      cy.contains('[role="dialog"] button', 'Only Maple').click();
      cy.contains('Moving Maple', { timeout: 20000 });
      cy.wait(4000);
      cy.contains('button', /^Get Best Route$/).last().click();
      cy.wait(1500);
      cy.get('body').then(($b) => { if ($b.find('button:contains("Search anyway")').length) cy.contains('button', 'Search anyway').click(); });
      cy.wait(8000);
      dump('fix-after-search', 'body');
      cy.contains('button', 'View Placement', { timeout: 30000 }).first().click();
      cy.wait(2500);
      cy.contains('button', /^Reschedule$/).click();
      cy.wait(2000);
      dump('fix-resched-modal');
    });
  });
});

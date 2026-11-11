/// <reference types="cypress" />
import '../../support/e2e';
import { dumpPage, PermKey, signInAsPerm } from './permKit';

const WHO: PermKey[] = (Cypress.env('PROBE_WHO') || 'practice_admin,practice_manager,medical_director,veterinarian,relief_veterinarian,lead_technician,technician,lead_client_liaison,client_liaison,inventory_manager,billing_ar,controlled_substances_director,mail_order_manager,mail_order_team,observer,executive').split(',');

describe('Permissions probe: menus per role', () => {
  for (const who of WHO) {
    it(who, () => {
      signInAsPerm(who, '/schedule');
      cy.wait(6000);
      cy.get('body').then(($b) => {
        // Open every nav dropdown so its items are in the dump.
        $b.find('nav details, header details').each((_, d) => { (d as HTMLDetailsElement).open = true; });
      });
      cy.wait(500);
      dumpPage(`menus-${who}`);
      cy.screenshot(`menus-${who}`, { capture: 'viewport' });
    });
  }
});

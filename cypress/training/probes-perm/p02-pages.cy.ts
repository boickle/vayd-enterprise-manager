/// <reference types="cypress" />
import '../../support/e2e';
import { schedulingWorld } from '../../support/schedulingWorld';
import { dumpPage, PermKey, signInAsPerm } from './permKit';

const WHO: PermKey[] = (Cypress.env('PROBE_WHO') || 'practice_admin,practice_manager,medical_director,veterinarian,relief_veterinarian,lead_technician,technician,lead_client_liaison,client_liaison,inventory_manager,billing_ar,controlled_substances_director,mail_order_manager,mail_order_team,observer,executive').split(',');

describe('Permissions probe: key pages per role', () => {
  for (const who of WHO) {
    it(who, () => {
      const w = schedulingWorld();
      const pages: Array<[string, string]> = [
        ['analytics', '/schedule/analytics'],
        ['settings', '/schedule/settings'],
        ['pharmacy', '/schedule/inventory'],
        ['tasks', '/schedule/tasks'],
        ['deposits', '/schedule/deposits'],
        ['marketing', '/schedule/marketing'],
        ['client', `/schedule/clients/${w.households.A.clientId}`],
      ];
      signInAsPerm(who, '/schedule/home');
      cy.wait(3000);
      for (const [name, path] of pages) {
        cy.visit(path);
        cy.wait(4500);
        dumpPage(`page-${name}-${who}`);
        cy.screenshot(`page-${name}-${who}`, { capture: 'viewport' });
      }
    });
  }
});

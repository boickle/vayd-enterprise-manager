/// <reference types="cypress" />
import '../../support/e2e';
import { schedulingApi, schedulingWorld } from '../../support/schedulingWorld';
import { dumpPage, PermKey, signInAsPerm } from './permKit';

const WHO: PermKey[] = (Cypress.env('PROBE_WHO') || 'practice_admin,practice_manager,medical_director,veterinarian,relief_veterinarian,lead_technician,technician,lead_client_liaison,client_liaison,inventory_manager,billing_ar,controlled_substances_director,mail_order_manager,mail_order_team,observer,executive').split(',');

describe('Permissions probe: a paid bill on the Chens, per role', () => {
  let paidId = '';
  before(() => {
    // The paid bill is made beforehand (cash, $75 Office exam, on the Chens); its id is in PAID_INVOICE.
    paidId = String(Cypress.env('PAID_INVOICE'));
  });
  for (const who of WHO) {
    it(who, () => {
      const w = schedulingWorld();
      signInAsPerm(who, `/schedule/clients?clientId=${w.households.B.clientId}`);
      cy.wait(6000);
      dumpPage(`client-${who}`);
      cy.screenshot(`client-${who}`, { capture: 'viewport' });
      cy.then(() => cy.visit(`/schedule/clients?clientId=${w.households.B.clientId}&tab=financial&invoice=${paidId}`));
      cy.wait(6000);
      dumpPage(`bill-${who}`);
      cy.screenshot(`bill-${who}`, { capture: 'viewport' });
    });
  }
});

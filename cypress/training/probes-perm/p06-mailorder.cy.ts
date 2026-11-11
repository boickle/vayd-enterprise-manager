/// <reference types="cypress" />
import '../../support/e2e';
import { dumpPage, signInAsPerm, PermKey } from './permKit';
const shot = (n: string) => { dumpPage(n); cy.screenshot(n, { capture: 'viewport' }); };
describe('Mail order roles', () => {
  for (const who of ['mail_order_team', 'mail_order_manager'] as PermKey[]) {
    it(who, () => {
      signInAsPerm(who, '/schedule/inventory/counts');
      cy.wait(6000);
      shot(`m-${who}-pharmacy`);
      cy.visit('/schedule/mail-orders');
      cy.wait(6000);
      shot(`m-${who}-queue`);
    });
  }
});

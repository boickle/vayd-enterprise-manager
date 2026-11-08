/// <reference types="cypress" />
/** OSV-03 probe, part 2: Maple's heartworm auto-ship in the portal: Manage, then the failing-card view. */
import '../../support/e2e';
import { osv, shot, signIn, sql } from './osvKit';

const openManage = (name: string) => {
  cy.contains('Maple', { timeout: 30000 }).click({ force: true });
  cy.wait(3000);
  cy.get('body').then(($b) => {
    const btn = $b.find('button').filter((_, el) => el.innerText.trim() === 'Manage');
    if (btn.length) {
      cy.wrap(btn.first()).scrollIntoView().click();
      cy.wait(1500);
      shot(name);
    } else {
      shot(`${name}-NO-MANAGE`);
    }
  });
};

describe('OSV-03 manage', () => {
  it('Manage, then failing', () => {
    const o = osv();
    sql(`UPDATE online_store_subscriptions SET "paymentStatus"=NULL WHERE "clientId"=${o.clients.rivera}`);
    signIn('client', '/client-portal');
    openManage('osv03-06-manage');
    sql(`UPDATE online_store_subscriptions SET "paymentStatus"='failing' WHERE "clientId"=${o.clients.rivera} AND "inventoryItemId"=${o.items.hw}`);
    cy.visit('/client-portal');
    openManage('osv03-07-manage-failing');
    sql(`UPDATE online_store_subscriptions SET "paymentStatus"=NULL WHERE "clientId"=${o.clients.rivera}`);
    cy.visit('/store/autoship');
    cy.contains(/Auto-ship items/i, { timeout: 30000 });
    shot('osv03-08-store-autoship');
  });
});

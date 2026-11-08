/// <reference types="cypress" />
/** OSV-02/03/04 probe: Rx auto-ship and Manage in the portal (failing card), Tom Chen's balance, guest checkout. */
import '../../support/e2e';
import { enterCard, osv, shot, signIn, sql } from './osvKit';

describe('OSV-02 to 04 client side', () => {
  it('OSV-03: Maria puts Maple heartworm on auto-ship and manages it in the portal', () => {
    const o = osv();
    signIn('client', '/store');
    cy.contains('button', 'Prescriptions', { timeout: 30000 }).click();
    cy.contains('Heartworm & flea chewable', { timeout: 30000 }).click();
    cy.contains('button', /^Maple$/, { timeout: 20000 }).click();
    shot('osv03-01-rx-product');
    cy.contains('button', /^Auto-ship/).click();
    cy.contains('button', 'Add to cart').click();
    cy.contains(/Added to cart/i, { timeout: 15000 });
    cy.visit('/store/cart');
    cy.contains(/Card on file/i, { timeout: 30000 });
    cy.get('body').then(($b) => {
      if ($b.text().includes('Yes — send it here')) cy.contains('Yes — send it here').click();
    });
    shot('osv03-02-cart');
    cy.contains('button', 'Place order').click();
    cy.contains('h1', 'Thank you', { timeout: 60000 });
    shot('osv03-03-thanks');
    cy.visit('/client-portal');
    cy.contains('Maple', { timeout: 30000 });
    cy.wait(3000);
    shot('osv03-04-portal-home');
    cy.contains('Maple').click({ force: true });
    cy.wait(2500);
    shot('osv03-05-maple');
    cy.get('body').then(($b) => {
      const btn = $b.find('button').filter((_, el) => el.innerText.trim() === 'Manage');
      if (btn.length) {
        cy.wrap(btn.first()).click();
        cy.wait(1500);
        shot('osv03-06-manage');
        cy.contains('button', /Close|Done/).first().click({ force: true });
      } else cy.log('NO MANAGE BUTTON');
    });
    // The card fails: what Maria sees.
    sql(
      `UPDATE online_store_subscriptions SET "paymentStatus"='failing' WHERE "clientId"=${o.clients.rivera} AND "inventoryItemId"=${o.items.hw} AND active`,
    );
    cy.reload();
    cy.contains('Maple', { timeout: 30000 }).click({ force: true });
    cy.wait(2500);
    cy.get('body').then(($b) => {
      const btn = $b.find('button').filter((_, el) => el.innerText.trim() === 'Manage');
      if (btn.length) {
        cy.wrap(btn.first()).click();
        cy.wait(1500);
        shot('osv03-07-manage-failing');
      }
    });
    sql(`UPDATE online_store_subscriptions SET "paymentStatus"=NULL WHERE "clientId"=${o.clients.rivera}`);
    cy.visit('/store/autoship');
    cy.contains(/Auto-ship items/i, { timeout: 30000 });
    shot('osv03-08-store-autoship');
  });

  it('OSV-04: Tom Chen sees his balance and the held eVet bill', () => {
    signIn('chen', '/client-portal');
    cy.contains(/Biscuit/i, { timeout: 30000 });
    cy.wait(4000);
    shot('osv04-01-portal');
    cy.get('body').then(($b) => {
      if ($b.text().includes('Account balance')) {
        cy.contains('Account balance').scrollIntoView();
        shot('osv04-02-balance');
      } else cy.log('NO ACCOUNT BALANCE CARD');
    });
  });

  it('OSV-02: a guest shops, buys a gift card, and checks a balance', () => {
    cy.clearLocalStorage();
    cy.visit('/store');
    cy.contains('Dental chews', { timeout: 30000 });
    shot('osv02-01-guest-home');
    cy.contains('button', 'Prescriptions').click();
    cy.contains('Heartworm & flea chewable', { timeout: 30000 }).click();
    cy.wait(2000);
    shot('osv02-02-guest-rx-product');
    cy.visit('/store');
    cy.contains('Dental chews', { timeout: 30000 }).click();
    cy.contains('button', 'Add to cart', { timeout: 20000 }).click();
    cy.contains(/Added to cart/i, { timeout: 15000 });
    cy.visit('/store/cart');
    cy.contains('Cart', { timeout: 30000 });
    cy.wait(2000);
    shot('osv02-03-guest-cart');
    cy.visit('/store');
    cy.contains('Gift Cards', { timeout: 30000 }).click();
    cy.wait(1500);
    shot('osv02-04-gift-cards');
    cy.contains('Gift card').click({ force: true });
    cy.wait(2000);
    shot('osv02-05-gift-product');
  });

  it('OSV-02: gift card balance check', () => {
    cy.visit('/store/gift-cards/balance');
    cy.contains(/Check a gift card balance/i, { timeout: 30000 });
    cy.get('input').first().type('RVRA-GKCD-HMNP-2345');
    cy.contains('button', /Check/i).click();
    cy.wait(2500);
    shot('osv02-06-balance');
  });
});

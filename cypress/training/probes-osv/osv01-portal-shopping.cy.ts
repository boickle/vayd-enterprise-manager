/// <reference types="cypress" />
/** OSV-01 probe: Maria Rivera shops in the portal: product page, auto-ship, cart, pay with 4242, thanks, auto-ship page. */
import '../../support/e2e';
import { enterCard, osv, shot, signIn, sql } from './osvKit';

describe('OSV-01 portal shopping', () => {
  it('walks the store as Maria', () => {
    const o = osv();
    // A clean start: no carts or orders from an earlier take, no saved Stripe card on the Riveras.
    sql(`UPDATE clients SET "stripeCustomerId"=NULL, "savedPaymentMethodId"=NULL WHERE id=${o.clients.rivera}`);
    signIn('client', '/client-portal');
    cy.contains(/Shop/i, { timeout: 30000 });
    shot('osv01-01-portal');
    cy.visit('/store');
    cy.contains('Joint support chews', { timeout: 30000 });
    shot('osv01-02-store-home');
    cy.contains('Joint support chews').click();
    cy.contains('Add to cart', { timeout: 20000 });
    shot('osv01-03-product');
    cy.contains('button', /^Maple$/).click();
    cy.contains('button', /^Auto-ship/).click();
    cy.contains('button', /every month/i).click();
    shot('osv01-04-maple-autoship');
    cy.contains('button', 'Add to cart').click();
    cy.contains(/Added to cart/i, { timeout: 15000 });
    cy.visit('/store');
    cy.contains('Dental chews', { timeout: 30000 }).click();
    cy.contains('button', /^Maple$/, { timeout: 20000 }).click();
    cy.contains('button', /^Buy once$/).click();
    cy.contains('button', 'Add to cart', { timeout: 20000 }).click();
    cy.contains(/Added to cart/i, { timeout: 15000 });
    cy.visit('/store/cart');
    cy.contains('Cart', { timeout: 30000 });
    shot('osv01-06-cart-top');
    shot('osv01-07-cart-bottom');
    cy.get('body').then(($b) => {
      if ($b.text().includes('Yes — send it here')) cy.contains('Yes — send it here').click();
    });
    cy.get('body').then(($b) => {
      if ($b.find('.vayd-store__card-box').length) enterCard();
    });
    shot('osv01-08-card-entered');
    cy.contains('button', 'Place order').click();
    cy.contains('h1', 'Thank you', { timeout: 60000 });
    shot('osv01-09-thanks');
    cy.visit('/store/autoship');
    cy.contains(/Auto-ship/i, { timeout: 30000 });
    shot('osv01-10-autoship-page');
    // Next visit to the cart: the saved card shows.
    cy.visit('/store');
    cy.contains('Dental chews', { timeout: 30000 }).click();
    cy.contains('button', /^Maple$/, { timeout: 20000 }).click();
    cy.contains('button', /^Buy once$/).click();
    cy.contains('button', 'Add to cart', { timeout: 20000 }).click();
    cy.contains(/Added to cart/i, { timeout: 15000 });
    cy.visit('/store/cart');
    cy.contains(/Card on file/i, { timeout: 30000 });
    shot('osv01-11-card-on-file');
  });
});

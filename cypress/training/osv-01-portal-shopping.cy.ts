/// <reference types="cypress" />
/**
 * Training video OSV-01: shopping the store as a portal client (docs/training/scripts/online-store/OSV-01-...).
 * TEST stack, Stripe TEST mode (test Visa 4242). Maria Rivera buys joint chews on auto-ship for Maple and dental chews once.
 */
import '../support/e2e';
import { enterTestCard, resetStoreData, signIn } from './osvTraining';
import { finish, line, loadNarration, offCamera, pointAt, startClock, tap } from './trainingKit';

describe('Training: OSV-01 portal shopping', () => {
  it('OSV-01', () => {
    loadNarration();
    resetStoreData();
    signIn('client', '/client-portal');
    cy.contains('.pp-greeting-name', 'Maria', { timeout: 40000 });
    cy.contains('Online pharmacy & store', { timeout: 30000 });
    cy.wait(1500);
    startClock();

    line('o01-why');
    line('o02-portal', () => pointAt(() => cy.get('.pp-greeting')));
    line('o03-remember');
    line('o04-shop', () => tap(() => cy.contains('a.pp-promo', 'Online pharmacy & store')));
    line('o05-tabs', () => {
      cy.contains('button', /^Featured$/, { timeout: 30000 });
      pointAt(() => cy.contains('button', /^Featured$/).parent(), 3500);
    });
    line('o06-joint', () => tap(() => cy.contains('Joint support chews')));
    line('o07-pet', () => tap(() => cy.contains('button', /^Maple$/, { timeout: 20000 })));
    line('o08-autoship', () => pointAt(() => cy.contains('button', /^Auto-ship/)));
    line('o09-monthly', () => tap(() => cy.contains('button', /every month \(recommended\)/)));
    line('o10-add', () => tap(() => cy.contains('button', /^Add to cart$/)));
    line('o11-back', () => tap(() => cy.contains('a', 'All products')));
    line('o12-dental', () => tap(() => cy.contains('Dental chews', { timeout: 30000 })));
    line('o13-dental-pet', () => tap(() => cy.contains('button', /^Maple$/, { timeout: 20000 })));
    line('o14-buy-once', () => tap(() => cy.contains('button', /^Buy once$/)));
    line('o15-add', () => tap(() => cy.contains('button', /^Add to cart$/)));
    line('o16-cart', () => tap(() => cy.get('a.vayd-store__nav-cart')));
    line('o17-lines', () => {
      cy.contains('Joint support chews', { timeout: 30000 });
      pointAt(() => cy.get('table').first(), 4500);
    });
    line('o18-shipping', () => pointAt(() => cy.contains('h2', 'Fulfillment').parent(), 5000));
    line('o19-address', () => tap(() => cy.contains('label', 'Yes — send it here')));
    line('o20-total', () => pointAt(() => cy.contains('h2', /^Total$/).parent(), 4500));
    line('o21-card', () => enterTestCard('4242424242424242', 'Maria Rivera'));
    line('o22-save', () => pointAt(() => cy.get('.vayd-store__card-save'), 4000));
    line('o23-place', () => tap(() => cy.contains('button', /^Place order$/).should('not.be.disabled')));
    line('o24-thanks', () => {
      cy.contains('h1', 'Thank you', { timeout: 60000 });
      pointAt(() => cy.contains('is in our mail queue'), 4000);
    });
    line('o25-autoship', () => tap(() => cy.contains('.vayd-store__nav a', /^Auto-ship$/)));
    line('o26-autoship-row', () => {
      cy.contains('For Maple', { timeout: 30000 });
      pointAt(() => cy.contains('For Maple').parent(), 5000);
    });
    // Next visit: the saved card waits in the cart.
    offCamera(() => {
      cy.visit(`/store`);
      cy.contains('Dental chews', { timeout: 30000 }).click();
      cy.contains('button', /^Maple$/, { timeout: 20000 }).click();
      cy.contains('button', /^Buy once$/).click();
      cy.contains('button', /^Add to cart$/).click();
      cy.visit('/store/cart');
      cy.contains(/Card on file/i, { timeout: 30000 });
      cy.wait(800);
    });
    line('o27-card-on-file', () => pointAt(() => cy.contains(/Card on file/i).parent(), 4500));
    line('o28-mistakes');
    line('o29-remember');
    finish();
  });
});

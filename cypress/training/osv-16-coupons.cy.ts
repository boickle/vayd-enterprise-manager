/// <reference types="cypress" />
/**
 * Training video OSV-16: coupons. TEST stack (nothing charged: Maria only applies the code in her cart).
 * Setup: the WELCOME10 test coupon is deleted before each take (TEST database only). Robin Hale makes it; Maria applies it.
 */
import '../support/e2e';
import { look, press, signIn, sql } from './osvTraining';
import { choose, finish, line, loadNarration, offCamera, startClock, tap, typeSlowly } from './trainingKit';

describe('Training: OSV-16 coupons', () => {
  it('OSV-16', () => {
    const field = (label: string) => cy.contains('.store-coupon-form label', label);
    loadNarration();
    sql(`DELETE FROM online_store_coupons WHERE code = 'WELCOME10'`);
    signIn('manager', '/schedule/inventory/online-store');
    cy.contains('button.settings-tab', /^Coupons$/, { timeout: 40000 });
    cy.wait(1500);
    startClock();

    line('k01-why');
    line('k02-tab', () => tap(() => cy.contains('button.settings-tab', /^Coupons$/)));
    line('k03-list', () => look(() => cy.contains('th', 'Limits').parents('table').first(), 4000));
    line('k04-remember');
    line('k05-add', () => press(() => cy.contains('button', /^Add coupon$/)));
    line('k06-code', () => typeSlowly(() => cy.get('input[placeholder="SAVE10"]'), 'WELCOME10'));
    line('k07-name', () => typeSlowly(() => field('Name').find('input'), 'Welcome to the store'));
    line('k08-discount', () => {
      field('Discount').find('input').clear();
      typeSlowly(() => field('Discount').find('input'), '10');
    });
    line('k09-uses', () => choose(() => field('Uses').find('select'), 'once_per_customer'));
    line('k10-min', () => {
      choose(() => field('Orders').find('select'), 'minimum');
      field('Orders').find('input').clear();
      typeSlowly(() => field('Orders').find('input'), '25');
    });
    line('k11-save', () => press(() => cy.contains('button', /^Save coupon$/)));
    line('k12-saved', () => look(() => cy.contains('td', 'WELCOME10', { timeout: 20000 }).parent('tr'), 4000));
    offCamera(() => {
      signIn('client', '/store');
      cy.contains('button', /^Featured$/, { timeout: 30000 }).click();
      cy.contains('a.vayd-store__card', 'Joint support chews', { timeout: 30000 }).click();
      cy.contains('button', /^Maple$/, { timeout: 20000 }).click();
      cy.contains('button', /^Buy once$/).click();
      cy.contains('button', /^Add to cart$/).click();
      cy.contains(/Added to cart/i, { timeout: 15000 });
      cy.visit('/store/cart');
      cy.get('.vayd-store__cart-coupon input', { timeout: 30000 });
      cy.wait(1500);
    });
    line('k13-cart', () => typeSlowly(() => cy.get('.vayd-store__cart-coupon input'), 'WELCOME10'));
    line('k14-apply', () => press(() => cy.get('.vayd-store__cart-coupon').contains('button', /^Apply$/)));
    line('k15-off', () => look(() => cy.contains('th', /^Coupon$/, { timeout: 20000 }).parent('tr'), 4000));
    line('k16-mistakes');
    line('k17-remember');
    finish();
  });
});

/// <reference types="cypress" />
/**
 * Training video OSV-23: pickup orders. TEST stack, Stripe TEST mode.
 * Setup: Maria's saved test Visa (an order bought and removed before the clock) and dental chews in her cart. She
 * chooses pickup at the Brunswick office; Riley fills it and sends it to check; Robin checks it and emails Maria.
 */
import '../support/e2e';
import { buyAsMaria, look, osv, press, resetStoreData, signIn, sql } from './osvTraining';
import { openOrder, openOrderQuietly, resetRefills } from './osvMailFlow';
import { finish, line, loadNarration, offCamera, startClock, tap } from './trainingKit';

describe('Training: OSV-23 pickup', () => {
  it('OSV-23', () => {
    const o = osv();
    let orderId = 0;
    loadNarration();
    resetStoreData();
    resetRefills();
    buyAsMaria({ tab: 'Featured', item: 'Joint support chews', pet: 'Maple', autoship: false }).then((id) =>
      sql(`DELETE FROM mail_orders WHERE id=${id} AND "clientId"=${o.clients.rivera}`)
    );
    signIn('client', '/store');
    cy.contains('button', /^Dental$/, { timeout: 30000 }).click();
    cy.contains('a.vayd-store__card', 'Dental chews', { timeout: 30000 }).click();
    cy.contains('button', /^Maple$/, { timeout: 20000 }).click();
    cy.contains('button', /^Buy once$/).click();
    cy.contains('button', /^Add to cart$/).click();
    cy.contains(/Added to cart/i, { timeout: 15000 });
    cy.visit('/store/cart');
    cy.contains('button', /^Place order$/, { timeout: 30000 });
    cy.wait(2500);
    startClock();

    line('k01-why');
    line('k02-choose', () => tap(() => cy.contains('button', 'Pick up at Brunswick Office')));
    line('k03-place', () => {
      press(() => cy.contains('button', /^Place order$/).should('not.be.disabled'));
      cy.contains('h1', 'Thank you', { timeout: 60000 });
    });
    offCamera(() => {
      sql(`SELECT max(id) FROM mail_orders WHERE "clientId"=${o.clients.rivera}`).then((v) => (orderId = Number(String(v).trim())));
      signIn('mailteam', '/schedule/mail-orders');
      cy.contains('Mail Order Queue', { timeout: 40000 });
      cy.contains('button', /^Fill$/).click();
      cy.wait(1500);
    });
    line('k04-fill', () => openOrder(() => orderId));
    line('k05-filled', () => press(() => cy.contains('button', /^Mark filled$/)));
    line('k06-pickup', () => {
      tap(() => cy.contains('button', /^Ship \/ pickup/, { timeout: 30000 }));
      openOrder(() => orderId);
      look(() => cy.contains('Office pickup — no EasyPost label', { timeout: 20000 }), 3500);
      cy.contains('button', /^Ready for check$/, { timeout: 30000 }).should('not.be.disabled');
    });
    line('k07-bag', () => press(() => cy.contains('button', /^Ready for check$/)));
    offCamera(() => {
      signIn('manager', '/schedule/mail-orders');
      cy.contains('Mail Order Queue', { timeout: 40000 });
      cy.contains('button', /^Check$/).click();
      cy.wait(1000);
      openOrderQuietly(() => orderId);
      cy.contains('button', /^I checked Maple$/, { timeout: 20000 });
      cy.wait(600);
    });
    line('k08-check', () => press(() => cy.contains('button', /^I checked Maple$/)));
    line('k09-tell', () => {
      tap(() => cy.contains('button', /^Contacted$/, { timeout: 30000 }));
      openOrder(() => orderId);
      cy.contains('button', /^Email client$/, { timeout: 20000 });
    });
    line('k09b-email', () => {
      tap(() => cy.contains('button', /^Email client$/));
      cy.contains('button', /^Send email$/, { timeout: 20000 });
    });
    line('k10-send', () => press(() => cy.contains('button', /^Send email$/)));
    line('k11-mistakes');
    line('k12-remember');
    finish();
  });
});

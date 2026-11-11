/// <reference types="cypress" />
/**
 * Training video OSV-24: an item ordered on another site (e.g. My Royal Canin). TEST stack, Stripe TEST mode.
 * Setup: Maria orders dental chews for Maple (stands in for a vendor-shipped item). Riley records it as ordered on
 * the vendor's site with their order number.
 */
import '../support/e2e';
import { buyAsMaria, look, press, resetStoreData, signIn } from './osvTraining';
import { openOrder, resetRefills } from './osvMailFlow';
import { finish, line, loadNarration, startClock, tap, typeSlowly } from './trainingKit';

describe('Training: OSV-24 ordered on another site', () => {
  it('OSV-24', () => {
    let orderId = 0;
    loadNarration();
    resetStoreData();
    resetRefills();
    buyAsMaria({ tab: 'Dental', item: 'Dental chews', pet: 'Maple', autoship: false }).then((id) => (orderId = Number(id)));
    signIn('mailteam', '/schedule/mail-orders');
    cy.contains('Mail Order Queue', { timeout: 40000 });
    cy.contains('button', /^Fill$/).click();
    cy.wait(2000);
    startClock();

    line('x01-why');
    line('x02-order', () => openOrder(() => orderId));
    line('x03-source', () => press(() => cy.contains('label', 'Ordered on another site')));
    line('x04-vendor', () => typeSlowly(() => cy.contains('label', 'Site / vendor').find('input'), 'My Royal Canin'));
    line('x05-ref', () => typeSlowly(() => cy.contains('label', 'Their order #').find('input'), 'RC-48211'));
    line('x06-filled', () => press(() => cy.contains('button', /^Mark filled$/).should('not.be.disabled')));
    line('x07-noship', () => {
      tap(() => cy.contains('button', /^Check$/, { timeout: 30000 }));
      openOrder(() => orderId);
      look(() => cy.contains(/Ordered on My Royal Canin/, { timeout: 20000 }).first(), 3500);
    });
    line('x08-default');
    line('x09-tell');
    line('x10-mistakes');
    line('x11-remember');
    finish();
  });
});

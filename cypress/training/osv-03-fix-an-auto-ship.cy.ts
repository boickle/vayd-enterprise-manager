/// <reference types="cypress" />
/**
 * Training video OSV-03: help a client change, pause or fix an auto-ship in the portal. TEST stack, Stripe TEST mode.
 * Setup: Maria puts Maple's heartworm chewable on auto-ship (test Visa). Mid-video the auto-ship is marked "failing"
 * in the TEST database, as Stripe's card-failed event would; it's set back at the end.
 */
import '../support/e2e';
import { buyAsMaria, osv, resetStoreData, signIn, sql } from './osvTraining';
import { finish, line, loadNarration, offCamera, pointAt, startClock, tap } from './trainingKit';

describe('Training: OSV-03 fix an auto-ship in the portal', () => {
  it('OSV-03', () => {
    const o = osv();
    const failing = (v: 'failing' | null) =>
      sql(
        `UPDATE online_store_subscriptions SET "paymentStatus"=${v ? `'${v}'` : 'NULL'} WHERE "clientId"=${o.clients.rivera} AND "inventoryItemId"=${o.items.hw} AND active`
      );
    const modal = () => cy.contains('.pp-modal', 'Auto-ship');
    loadNarration();
    resetStoreData();
    buyAsMaria({ tab: 'Prescriptions', item: 'Heartworm & flea chewable', pet: 'Maple', autoship: true });
    failing(null);
    signIn('client', '/client-portal');
    cy.contains('.pp-greeting-name', 'Maria', { timeout: 40000 });
    cy.contains('button.pp-switch', 'Maple', { timeout: 30000 });
    cy.wait(1500);
    startClock();

    line('a01-why');
    line('a02-maple', () => tap(() => cy.contains('button.pp-switch', 'Maple')));
    line('a03-med', () => {
      // Scroll first and let it settle, so the outline lands on the medicine row.
      cy.contains('.pp-row-title', 'Heartworm & flea chewable', { timeout: 20000 }).then(($e) => $e[0].scrollIntoView({ block: 'center' }));
      cy.wait(700);
      pointAt(() => cy.contains('.pp-row-title', 'Heartworm & flea chewable').parents('.pp-row-main').first(), 4000);
    });
    line('a04-manage', () => tap(() => cy.contains('button', /Manage$/)));
    line('a05-next', () => pointAt(() => cy.get('.pp-autoship-summary', { timeout: 20000 }), 4000));
    line('a06-often', () => pointAt(() => cy.contains('label.pp-field', 'How often')));
    line('a07-qty', () => pointAt(() => cy.contains('label.pp-field', 'Quantity per shipment')));
    line('a08-date', () => pointAt(() => cy.contains('.pp-field', 'Next shipment').last(), 4500));
    line('a09-pause', () => pointAt(() => cy.contains('button', 'Pause for a while')));
    line('a10-cancel', () => pointAt(() => cy.contains('button', 'Cancel auto-ship')));
    line('a11-extra', () => pointAt(() => cy.contains('button', 'Order an extra now')));
    line('a12-done', () => tap(() => cy.contains('button', /^Done$/)));
    // The card is declined: Stripe's event would set this; the training database gets it directly.
    offCamera(() => {
      failing('failing');
      cy.reload();
      cy.contains('button.pp-switch', 'Maple', { timeout: 30000 }).click();
      cy.contains('button', /Manage$/, { timeout: 20000 }).click();
      cy.get('[data-testid="autoship-payment-failing"]', { timeout: 20000 });
      cy.wait(600);
    });
    line('a13-banner', () => pointAt(() => cy.get('[data-testid="autoship-payment-failing"]'), 4000));
    line('a14-remember');
    line('a15-update', () => tap(() => cy.contains('[data-testid="autoship-payment-failing"] button', 'Update card')));
    line('a16-card', () => pointAt(() => modal().find('.vayd-store__card-panel', { timeout: 20000 }).first(), 4000));
    offCamera(() => {
      failing(null);
      cy.visit('/store');
      cy.contains('.vayd-store__nav a', /^Auto-ship$/, { timeout: 30000 });
      cy.wait(600);
    });
    line('a17-all', () => tap(() => cy.contains('.vayd-store__nav a', /^Auto-ship$/)));
    line('a18-row', () => pointAt(() => cy.contains('For Maple', { timeout: 30000 }).parent(), 5000));
    line('a19-mistakes');
    line('a20-remember');
    finish();
  });
});

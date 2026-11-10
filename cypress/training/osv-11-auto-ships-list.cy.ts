/// <reference types="cypress" />
/**
 * Training video OSV-11: the Auto-ships list. TEST stack, Stripe TEST mode.
 * Setup: Maria puts Maple on two auto-ships in the store (joint chews monthly, heartworm every 6 months), and the
 * heartworm one is marked "failing" in the TEST database, as Stripe's card-failed event would. Riley Brooks (mail order
 * team) pauses one and opens Edit; Robin Hale (manager) opens Edit to show what managers can change.
 */
import '../support/e2e';
import { buyAsMaria, look, osv, press, resetStoreData, signIn, sql } from './osvTraining';
import { finish, line, loadNarration, offCamera, startClock, tap } from './trainingKit';

describe('Training: OSV-11 auto-ships list', () => {
  it('OSV-11', () => {
    const o = osv();
    const PAGE = '/schedule/inventory/auto-ships';
    const row = (item: RegExp) => cy.contains('article.autoship-list__card', item, { timeout: 20000 });
    const editWindow = () => cy.contains('h3', 'Edit auto-ship').parents('[role="dialog"]').first();
    loadNarration();
    resetStoreData();
    buyAsMaria({ tab: 'Featured', item: 'Joint support chews', pet: 'Maple', autoship: true });
    buyAsMaria({ tab: 'Prescriptions', item: 'Heartworm & flea chewable', pet: 'Maple', autoship: true });
    sql(
      `UPDATE online_store_subscriptions SET "paymentStatus"='failing' WHERE "clientId"=${o.clients.rivera} AND "inventoryItemId"=${o.items.hw} AND active`
    );
    signIn('mailteam', PAGE);
    cy.contains('h2', 'Auto-ships', { timeout: 40000 });
    row(/Joint support chews/);
    cy.wait(1500);
    startClock();

    line('s01-why');
    line('s02-rows', () => look(() => cy.get('.mail-queue__list'), 4500));
    line('s03-remember');
    line('s04-problems', () => tap(() => cy.contains('button', /^Payment problems$/)));
    line('s05-failing', () => look(() => cy.contains('.mail-queue__badge', 'Payment failing', { timeout: 20000 }), 4000));
    line('s06-active', () => tap(() => cy.contains('button', /^Active$/)));
    line('s07-pause', () => press(() => row(/Joint support chews/).contains('button', /^Pause$/)));
    line('s08-resume', () => look(() => cy.contains('label', 'Resume on', { timeout: 20000 }), 3500));
    line('s08b-confirm', () => press(() => cy.contains('button', /^Pause until /)));
    line('s08c-paused', () => {
      cy.contains('h3', 'Pause auto-ship').should('not.exist');
      cy.contains('button', /^Paused$/).click();
      look(() => cy.contains('.mail-queue__badge', /^Paused until /, { timeout: 30000 }), 3500);
    });
    line('s09-edit', () => {
      cy.contains('button', /^Active$/).click();
      tap(() => row(/Heartworm/).contains('button', /^Edit$/));
    });
    line('s10-locked', () => look(() => cy.get('[data-testid="autoship-locked-note"]', { timeout: 20000 }), 6000));
    line('s10b-often', () => look(() => editWindow().contains('label', 'Frequency'), 3000));
    line('s11-close', () => press(() => cy.get('.edit-autoship-list-modal__footer').contains('button', /^Cancel$/)));
    offCamera(() => {
      signIn('manager', PAGE);
      row(/Heartworm/);
      cy.wait(800);
    });
    line('s12-robin', () => press(() => row(/Heartworm/).contains('button', /^Edit$/)));
    line('s13-price', () => look(() => cy.contains('Price differences charge the card on file', { timeout: 20000 }), 5000));
    line('s14-cancel', () => press(() => cy.get('.edit-autoship-list-modal__footer').contains('button', /^Cancel$/)));
    line('s15-card', () => look(() => row(/Heartworm/).find('.autoship-list__actions'), 4500));
    line('s16-mistakes');
    line('s17-remember');
    finish();
  });
});

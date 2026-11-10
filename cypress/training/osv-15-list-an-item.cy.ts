/// <reference types="cypress" />
/**
 * Training video OSV-15: list an item in the store. TEST stack.
 * Setup: the demo catalog. Robin Hale walks the Store items page, then starts a new store product and tries to add
 * Gabapentin (a controlled drug), which Scout refuses. The test product is deleted before each take (TEST database only).
 */
import '../support/e2e';
import { look, press, signIn, sql } from './osvTraining';
import { finish, line, loadNarration, startClock, tap, typeSlowly } from './trainingKit';

describe('Training: OSV-15 list an item', () => {
  it('OSV-15', () => {
    const NEW = 'Calming capsules';
    const card = (name: string) => cy.contains('.store-item-card__title', name, { timeout: 30000 }).parents('.store-item-card').first();
    loadNarration();
    sql(`DELETE FROM online_store_products WHERE name = '${NEW}'`);
    signIn('manager', '/schedule/inventory/online-store');
    card('Dental chews');
    cy.wait(1500);
    startClock();

    line('p01-why');
    line('p02-counts', () => look(() => cy.contains('button', /^On the store \(/).parent(), 4000));
    line('p03-dental', () => look(() => card('Dental chews').find('.store-item-card__head'), 5000));
    line('p04-remember');
    line('p05-hw', () => look(() => card('Heartworm & flea chewable').contains('.store-item-card__control', 'Approval'), 4500));
    line('p06-more', () => look(() => card('Dental chews').find('.store-item-card__body'), 5000));
    line('p07-add', () => press(() => cy.contains('button', /^\+ Add store item$/)));
    line('p08-name', () => typeSlowly(() => cy.get('input[placeholder="e.g. Apoquel Chewable Tablets"]', { timeout: 20000 }), NEW));
    line('p09-create', () => press(() => cy.contains('button', /^Create master product$/)));
    line('p10-search', () =>
      typeSlowly(() => cy.get('input[placeholder="Search inventory or procedures to add"]', { timeout: 30000 }), 'Gabapentin')
    );
    line('p11-try', () =>
      tap(() => cy.contains('Gabapentin 100 mg', { timeout: 20000 }).parents('li, tr, div').filter(':has(button)').first().contains('button', /^Add/))
    );
    line('p12-refused', () => look(() => cy.contains(/is a controlled drug, so it can't be/, { timeout: 20000 }), 6000));
    line('p13-mistakes');
    line('p14-remember');
    finish();
  });
});

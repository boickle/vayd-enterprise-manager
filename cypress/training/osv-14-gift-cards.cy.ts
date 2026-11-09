/// <reference types="cypress" />
/**
 * Training video OSV-14: gift cards, staff side. TEST stack (nothing charged; no email: the card is issued to print).
 * Setup: only the demo $50 card issued to Maria Rivera; other cards from earlier takes are deleted (TEST database only).
 * Robin Hale finds Maria's card, then issues a service-recovery card to Tom Chen.
 */
import '../support/e2e';
import { look, press, signIn, sql } from './osvTraining';
import { finish, line, loadNarration, offCamera, startClock, tap, typeSlowly } from './trainingKit';

describe('Training: OSV-14 gift cards', () => {
  it('OSV-14', () => {
    loadNarration();
    sql(`DELETE FROM gift_cards WHERE code <> 'RVRAGKCDHMNP2345'`);
    signIn('manager', '/schedule/inventory/gift-cards');
    cy.contains('h2', 'Sold gift cards', { timeout: 40000 });
    cy.contains('td', 'Maria Rivera', { timeout: 30000 });
    cy.wait(1500);
    startClock();

    line('g01-why');
    line('g02-list', () => look(() => cy.contains('th', 'Card').parents('table').first(), 4500));
    line('g03-totals', () => look(() => cy.get('.gift-year-summary'), 4500));
    line('g04-remember');
    line('g05-search', () => typeSlowly(() => cy.get('input[placeholder="Last 4 or full code, name, email"]'), 'Rivera'));
    line('g06-open', () => tap(() => cy.contains('td', 'Maria Rivera')));
    line('g07-card', () => look(() => cy.contains('h3', /^Gift card ••••/, { timeout: 20000 }).parents('.settings-card').first(), 5000));
    line('g08-actions', () => look(() => cy.contains('button', /^Email card$/).parent(), 5000));
    offCamera(() => {
      cy.contains('button', /^Close$/).click();
      cy.get('input[placeholder="Last 4 or full code, name, email"]').clear();
      cy.wait(600);
    });
    line('g09-issue', () => press(() => cy.contains('button', /^Issue gift card$/)));
    line('g10-amount', () => typeSlowly(() => cy.contains('label', 'Amount').find('input'), '25'));
    line('g11-reason', () => typeSlowly(() => cy.contains('label', 'Reason *').find('input'), 'Service recovery: late visit'));
    line('g12-who', () => typeSlowly(() => cy.contains('label', 'Recipient name').find('input'), 'Tom Chen'));
    line('g13-print', () => look(() => cy.contains('label', 'Recipient email'), 3500));
    line('g14-send', () => press(() => cy.contains('h3', 'Issue a gift card').parents('.settings-card').first().contains('button', /^Issue gift card$/)));
    line('g15-issued', () => look(() => cy.contains('issued by staff (Service recovery: late visit)', { timeout: 20000 }), 4000));
    line('g16-mistakes');
    line('g17-remember');
    finish();
  });
});

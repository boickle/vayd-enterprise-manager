/// <reference types="cypress" />
/**
 * Training video OSV-02: guests, gift cards and items without a login. TEST stack, Stripe TEST mode (test Visa).
 * A guest (Sam Ortiz, example.com) buys a $50 gift card for Tom Chen; the email goes to the stack's capture file.
 */
import '../support/e2e';
import { asGuest, enterTestCard, osv } from './osvTraining';
import { finish, line, loadNarration, offCamera, pointAt, startClock, tap, typeSlowly } from './trainingKit';

describe('Training: OSV-02 guests and gift cards', () => {
  it('OSV-02', () => {
    loadNarration();
    asGuest('/store');
    cy.contains('Dental chews', { timeout: 30000 });
    cy.wait(1500);
    startClock();

    line('g01-why');
    line('g02-guest', () => pointAt(() => cy.contains('.vayd-store__nav a', /^Log in$/)));
    line('g03-remember');
    line('g04-tab', () => tap(() => cy.contains('a, button', /^Gift Cards$/)));
    line('g06-amount', () => tap(() => cy.contains('button', /^\$50(\.00)?$/, { timeout: 20000 })));
    line('g07-who', () => pointAt(() => cy.contains('Who is it for?').parent(), 3500));
    line('g08-name', () => typeSlowly(() => cy.contains('label', 'Recipient name').find('input'), 'Tom Chen'));
    line('g09-email', () => typeSlowly(() => cy.contains('label', 'Recipient email').find('input'), 'tom.chen@example.com'));
    line('g10-from', () => typeSlowly(() => cy.contains('label', /^From/).find('input'), 'Sam Ortiz'));
    line('g11-message', () => typeSlowly(() => cy.contains('label', 'Message (optional)').find('textarea'), 'Happy birthday to Biscuit!'));
    line('g12-when', () => pointAt(() => cy.contains('When should we send it?').parent(), 3500));
    line('g13-add', () => tap(() => cy.contains('button', /^Add \$50(\.00)? gift card/)));
    line('g14-cart', () => tap(() => cy.get('a.vayd-store__nav-cart')));
    line('g15-details', () => {
      cy.contains('h2', 'Your details', { timeout: 30000 });
      typeSlowly(() => cy.contains('label', /^Name$/).find('input'), 'Sam Ortiz');
      typeSlowly(() => cy.contains('label', /^Email$/).find('input'), 'sam.ortiz@example.com');
    });
    line('g16-card', () => enterTestCard('4242424242424242', 'Sam Ortiz'));
    line('g17-no-tax', () => pointAt(() => cy.contains('No tax or shipping on gift cards.')));
    line('g18-pay', () => tap(() => cy.contains('button', /^Pay \$50\.00$/).should('not.be.disabled')));
    line('g19-thanks', () => {
      cy.contains('h1', 'Thank you', { timeout: 60000 });
      pointAt(() => cy.contains('h2', 'Your gift card').parent(), 4500);
    });
    // A one-time item, as a guest.
    line('g20-shop', () => tap(() => cy.contains('.vayd-store__nav a', /^Shop$/)));
    line('g21-dental', () => tap(() => cy.contains('Dental chews', { timeout: 30000 })));
    line('g22-add', () => tap(() => cy.contains('button', /^Add to cart$/, { timeout: 20000 })));
    line('g23-cart', () => tap(() => cy.get('a.vayd-store__nav-cart')));
    line('g24-banner', () => pointAt(() => cy.get('.vayd-store__guest-note', { timeout: 30000 }), 4500));
    line('g25-total', () => pointAt(() => cy.contains('h2', /^Total$/).parent(), 4000));
    // A prescription, as a guest.
    line('g26-rx', () => tap(() => cy.contains('.vayd-store__nav a', /^Shop$/)));
    line('g27-rx-tab', () => tap(() => cy.contains('button', /^Prescriptions$/, { timeout: 30000 })));
    line('g28-rx-item', () => tap(() => cy.contains('Heartworm & flea chewable', { timeout: 30000 })));
    line('g29-rx-login', () => pointAt(() => cy.contains('Log in to your client portal to order it').parent(), 5000));
    // Anyone can check a balance.
    offCamera(() => {
      cy.visit('/store');
      cy.contains('a, button', /^Gift Cards$/, { timeout: 30000 }).click();
      cy.contains('button', 'Check gift card balance', { timeout: 20000 });
      cy.wait(600);
    });
    line('g30-balance', () => tap(() => cy.contains('button', 'Check gift card balance')));
    line('g31-code', () => typeSlowly(() => cy.contains('label', 'Gift card code').find('input'), osv().giftCard.code));
    line('g32-check', () => tap(() => cy.contains('button', /^Check balance$/)));
    line('g33-result', () => pointAt(() => cy.contains(/Gift card ••••\d{4}:/, { timeout: 20000 }).parent(), 5000));
    line('g34-mistakes');
    line('g35-remember');
    finish();
  });
});

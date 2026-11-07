/// <reference types="cypress" />
/** Probe for SR-08: what the family sees when they tap the offer link. */
import '../../support/e2e';
import { dump } from './srKit';
describe('SR-08 confirm page', () => {
  it('family taps the link', () => {
    cy.clearAllLocalStorage();
    cy.visit('/confirm/jph0hKOYs4gH');
    cy.wait(5000);
    dump('sr08-confirm-page', 'body');
    cy.screenshot('sr08-confirm-page', { capture: 'viewport' });
    cy.contains('button', 'Confirm this time').click();
    cy.wait(5000);
    dump('sr08-confirmed', 'body');
  });
});

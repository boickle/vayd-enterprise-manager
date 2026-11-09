/// <reference types="cypress" />
import '../../support/e2e';
import { signInAsScheduling } from '../../support/schedulingWorld';
import { openVisit } from '../invKit';
import { pets, resetMembershipWorld } from '../memKit';

describe('probe p06b', () => {
  it('portal signup flow', () => {
    resetMembershipWorld();
    openVisit(pets().juniper, pets().maria, 'Wellness visit', -60 * 24 * 3);
    signInAsScheduling('client', '/client-portal/membership-signup');
    cy.contains('Juniper', { timeout: 60000 }).click();
    cy.wait(6000);
    cy.screenshot('01-plans', { capture: 'viewport' });
    cy.document().then((d) => cy.writeFile(Cypress.env('PROBE_OUT') + '/plans.txt', d.body.innerText));
    cy.contains('button', 'Add to Cart').first().click();
    cy.wait(2000);
    cy.screenshot('02-cart', { capture: 'fullPage' });
    cy.document().then((d) => cy.writeFile(Cypress.env('PROBE_OUT') + '/cart.txt', d.body.innerText));
  });
});

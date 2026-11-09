/// <reference types="cypress" />
import '../../support/e2e';
import { signInAsScheduling } from '../../support/schedulingWorld';
import { resetMembershipWorld } from '../memKit';

describe('probe p06', () => {
  it('portal signup', () => {
    resetMembershipWorld();
    signInAsScheduling('client', '/client-portal');
    cy.wait(6000);
    cy.screenshot('01-portal', { capture: 'viewport' });
    cy.document().then((d) => cy.writeFile(Cypress.env('PROBE_OUT') + '/portal.txt', d.body.innerText));
    cy.visit('/client-portal/membership-signup');
    cy.wait(7000);
    cy.screenshot('02-signup', { capture: 'viewport' });
    cy.document().then((d) => cy.writeFile(Cypress.env('PROBE_OUT') + '/signup.txt', d.body.innerText));
  });
});

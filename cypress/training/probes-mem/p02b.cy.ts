/// <reference types="cypress" />
import '../../support/e2e';
import { signInAsScheduling } from '../../support/schedulingWorld';
import { pets, sql } from '../memKit';

describe('probe p02b', () => {
  it('pay counter invoice', () => {
    const p = pets();
    sql(`SELECT id FROM visit_invoices WHERE "clientId"=${p.maria} AND "isDeleted"=false AND status='open' ORDER BY created DESC LIMIT 1`).then((id) => {
      signInAsScheduling('cl', `/schedule/clients?clientId=${p.maria}&tab=financial&invoice=${String(id).trim()}&patientId=${p.juniper}`);
    });
    cy.contains('Membership - Feline Foundations - Monthly', { timeout: 60000 }).should('exist');
    cy.wait(3000);
    cy.get('.client-fin__field--pay-method select').scrollIntoView();
    cy.screenshot('01-pay-area', { capture: 'viewport' });
    cy.get('.client-fin__field--pay-method select').select('phone');
    cy.wait(4000);
    cy.screenshot('02-card-over-phone', { capture: 'viewport' });
    cy.document().then((d) => cy.writeFile(Cypress.env('PROBE_OUT') + '/page.txt', d.body.innerText));
  });
});

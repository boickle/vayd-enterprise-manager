/// <reference types="cypress" />
// Probe (not a video): what the Membership section looks like for a member and a non-member.
import '../../support/e2e';
import { signInAsScheduling } from '../../support/schedulingWorld';
import { chartUrl, enrolPet, pets, PLAN, resetMembershipWorld, sql, useBenefits } from '../memKit';

describe('probe p01', () => {
  it('panel', () => {
    const p = pets();
    resetMembershipWorld();
    enrolPet(p.maple, PLAN.dogFoundationsMonthly, { startDaysAgo: 40 }).then((id) => {
      cy.log(`membership ${id}`);
      sql(`SELECT string_agg(COALESCE(pr.name, ii.name, l.name) || '=' || i."includedQuantity", '; ') FROM wellness_plan_items i LEFT JOIN procedures pr ON pr.id=i."procedureId" LEFT JOIN inventory_items ii ON ii.id=i."inventoryItemId" LEFT JOIN labs l ON l.id=i."labId" WHERE i."wellnessPlanId"=${id}`).then((s) => cy.writeFile(Cypress.env('PROBE_OUT') + '/benefits.txt', String(s)));
    });
    cy.viewport(1440, 900);
    signInAsScheduling('cl', chartUrl(p.maple));
    cy.contains('button', 'Membership', { timeout: 60000 }).should('exist');
    cy.wait(4000);
    cy.screenshot('01-chart-top', { capture: 'viewport' });
    cy.get('.pmp').scrollIntoView();
    cy.wait(1000);
    cy.screenshot('02-panel', { capture: 'viewport' });
    cy.get('.pmp').screenshot('03-panel-full');
    signInAsScheduling('cl', chartUrl(p.juniper));
    cy.contains('button', 'Membership', { timeout: 60000 }).should('exist');
    cy.wait(3000);
    cy.get('.pmp').scrollIntoView();
    cy.get('.pmp').screenshot('04-nonmember');
  });
});

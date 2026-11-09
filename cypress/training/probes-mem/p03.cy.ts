/// <reference types="cypress" />
import '../../support/e2e';
import { signInAsScheduling } from '../../support/schedulingWorld';
import { chartUrl, pets } from '../memKit';

describe('probe p03', () => {
  it('invoice tick', () => {
    const p = pets();
    signInAsScheduling('cl', chartUrl(p.juniper));
    cy.contains('button', 'Post-appointment sign-up', { timeout: 60000 }).click();
    cy.get('.pvms-invoice-row', { timeout: 30000 }).should('exist');
    cy.wait(3000);
    cy.get('.pvms-invoice-row input').first().click();
    cy.wait(1500);
    cy.screenshot('01-after-click', { capture: 'viewport' });
    cy.get('.pvms-invoice-row input').first().then(($i) => cy.writeFile(Cypress.env('PROBE_OUT') + '/state.txt', `cypress: checked=${($i[0] as HTMLInputElement).checked} disabled=${($i[0] as HTMLInputElement).disabled} rows=${Cypress.$('.pvms-invoice-row').length}\n`));
    cy.get('.pvms-invoice-row input').first().then(($i) => ($i[0] as HTMLInputElement).click());
    cy.wait(1500);
    cy.get('.pvms-invoice-row input').first().then(($i) => cy.writeFile(Cypress.env('PROBE_OUT') + '/state.txt', `native: checked=${($i[0] as HTMLInputElement).checked}\n`, { flag: 'a+' }));
    cy.contains('.pvms-plan', 'Feline Foundations').click();
    cy.wait(1500);
    cy.contains('.pvms-plan', 'Feline Foundations').then(($b) => cy.writeFile(Cypress.env('PROBE_OUT') + '/state.txt', `plan class=${$b.attr('class')}\n`, { flag: 'a+' }));
    cy.get('.pvms-preview-btn').then(($b) => cy.writeFile(Cypress.env('PROBE_OUT') + '/state.txt', `calc disabled=${$b.prop('disabled')}\n`, { flag: 'a+' }));
    cy.screenshot('02-after', { capture: 'viewport' });
  });
});

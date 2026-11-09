/// <reference types="cypress" />
import '../../support/e2e';
import { signInAsScheduling } from '../../support/schedulingWorld';
import { chartUrl, drawSignature, pets, quietChart, resetMembershipWorld, sql } from '../memKit';
import { pointAt, tap, typeSlowly } from '../trainingKit';

describe('probe p02', () => {
  it('enrol', () => {
    const p = pets();
    resetMembershipWorld();
    sql(`UPDATE clients SET "stripeCustomerId"='cus_memtrain_maria', "savedPaymentMethodId"='pm_card_visa', "cardOnFileConsentAt"=now(), "cardOnFileConsentAgreementVersion"='2026-10-07', "cardOnFileConsentSource"='training', "cardOnFileDeclinedAt"=NULL WHERE id=${p.maria}`);
    signInAsScheduling('cl', chartUrl(p.juniper));
    cy.screenshot('00-signed-in', { capture: 'viewport' });
    quietChart();
    cy.screenshot('00b-quiet', { capture: 'viewport' });
    cy.contains('button', 'Enroll in a plan', { timeout: 60000 }).click();
    cy.wait(1500);
    cy.screenshot('01-waiver', { capture: 'viewport' });
    cy.get('.membership-waiver__check input').check();
    cy.screenshot('01b-checked', { capture: 'viewport' });
    drawSignature(() => cy.get('.membership-waiver__draw canvas'));
    cy.get('.membership-waiver__sign input').type('Maria Rivera');
    cy.screenshot('02-signed', { capture: 'viewport' });
    cy.contains('.pmp-plan', 'Membership - Feline Foundations - Monthly').scrollIntoView();
    cy.screenshot('03-plans', { capture: 'viewport' });
    cy.contains('.pmp-plan', 'Membership - Feline Foundations - Monthly').find('button').should('not.be.disabled').click();
    cy.wait(800);
    cy.screenshot('04-confirm', { capture: 'viewport' });
    cy.contains('button', /^Enroll$/).last().click();
    cy.location('search', { timeout: 60000 }).should('contain', 'tab=financial');
    cy.wait(5000);
    cy.screenshot('05-financial', { capture: 'viewport' });
    cy.document().then((d) => cy.writeFile(Cypress.env('PROBE_OUT') + '/financial.txt', d.body.innerText));
  });
});

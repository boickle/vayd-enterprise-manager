/// <reference types="cypress" />
import '../../support/e2e';
import { signInAsScheduling } from '../../support/schedulingWorld';
import { chartUrl, enrolPet, fileAgreement, pets, PLAN_GOLDEN_DOG, quietChart, resetMembershipWorld } from '../memKit';

describe('probe p15', () => {
  it('deactivate member', () => {
    const p = pets();
    resetMembershipWorld();
    enrolPet(p.pepper, PLAN_GOLDEN_DOG, { startDaysAgo: 90 });
    fileAgreement(p.pepper, p.maria, 90);
    signInAsScheduling('cl', chartUrl(p.pepper, false));
    quietChart();
    cy.contains('button', 'Deactivate', { timeout: 60000 }).click();
    cy.wait(4000);
    cy.screenshot('01-after-deactivate', { capture: 'viewport' });
    cy.document().then((d) => cy.writeFile(Cypress.env('PROBE_OUT') + '/d1.txt', (d.querySelector('[role="dialog"]') as HTMLElement | null)?.innerText || 'no dialog'));
  });
});

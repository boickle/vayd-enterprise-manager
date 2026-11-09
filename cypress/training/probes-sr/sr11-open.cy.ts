/// <reference types="cypress" />
import '../../support/e2e';
import { includeSeededDoctorsInProviderList, signInAsScheduling } from '../../support/schedulingWorld';
import { resetDemo, srBook } from './srKit';

describe('SR-11 open/convert probe', () => {
  it('opens the calendar', () => {
    resetDemo();
    const db = String(Cypress.env('SCH_DB'));
    cy.exec(`psql -d ${db} -c "update appointments set \\"isActive\\"=false where \\"isDeleted\\"=true and \\"isActive\\"=true"`);
    srBook('biscuit', 14, 0, 'hold', 45, 'A', 'Hold: new kitten exam, owner to confirm');
    includeSeededDoctorsInProviderList();
    signInAsScheduling('cl', '/schedule/holds');
    cy.contains('button', 'Open / convert', { timeout: 60000 }).click();
    cy.wait(8000);
    cy.url().then((u) => cy.writeFile('cypress/training/probes-sr/out/sr11-url.txt', u));
    cy.screenshot('sr11-open', { capture: 'viewport' });
  });
});

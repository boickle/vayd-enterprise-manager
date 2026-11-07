/// <reference types="cypress" />
/** Probe for SR-18 and SR-19: Settings as the manager. */
import '../../support/e2e';
import { includeSeededDoctorsInProviderList, signInAsScheduling } from '../../support/schedulingWorld';
import { dump } from './srKit';
describe('SR-18/19', () => {
  it.skip('closed dates', () => {
    includeSeededDoctorsInProviderList();
    signInAsScheduling('admin' as any, '/schedule/settings?tab=appointment-types');
    cy.wait(6000);
    cy.contains(/closed/i).scrollIntoView();
    cy.wait(1000);
    dump('sr19-closed', 'body');
    cy.screenshot('sr19-closed', { capture: 'viewport' });
  });
  it('staff schedule', () => {
    includeSeededDoctorsInProviderList();
    signInAsScheduling('admin' as any, '/schedule/settings?tab=employee-directory');
    cy.wait(6000);
    dump('sr18-staff', 'body');
    cy.get('select[aria-label="Staff"]').select('Avery Lane · Provider');
    cy.wait(3000);
    cy.contains('button, [role="tab"], a', /^Schedule/).first().click({ force: true });
    cy.wait(4000);
    dump('sr18-lane', 'body');
    cy.screenshot('sr18-lane', { capture: 'viewport' });
    cy.contains('button', 'Date overrides').click();
    cy.wait(2500);
    dump('sr18-overrides');
    cy.screenshot('sr18-overrides', { capture: 'viewport' });
  });
});

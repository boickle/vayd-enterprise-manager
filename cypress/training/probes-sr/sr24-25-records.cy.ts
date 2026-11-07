/// <reference types="cypress" />
/** Probe for SR-24 and SR-25: request records from a visit; the Records list. */
import '../../support/e2e';
import { includeSeededDoctorsInProviderList, signInAsScheduling } from '../../support/schedulingWorld';
import { dump, menuPick, openDemoDay, resetDemo, srBook } from './srKit';
describe('SR-24/25', () => {
  it('request records', () => {
    resetDemo();
    srBook('biscuit', 11, 0, 'recheck', 45, 'A', 'Ear recheck').then(({ id }) => {
      openDemoDay('cl');
      menuPick(id, 'Visit Prep', 'Request');
      cy.wait(3000);
      dump('sr24-modal');
      cy.screenshot('sr24-modal', { capture: 'viewport' });
      cy.get('input[placeholder="Name of the practice"]').type('Maplewood Animal Hospital');
      cy.get('input[placeholder="records@example.com"]').type('records@maplewood-vet.example');
      cy.contains('Client has authorized us').parent().find('input[type="checkbox"]').check({ force: true });
      dump('sr24-filled');
      cy.contains('button', 'Send 1 request').click();
      cy.wait(3000);
      dump('sr24-after-send');
      cy.contains('button', 'Done').click({ force: true });
      cy.wait(2000);
      cy.get(`[data-appt-id="${id}"]`).first().invoke('text').then((t) => cy.writeFile('cypress/training-out/probe-text/sr24-card.txt', t));
      cy.get(`[data-appt-id="${id}"]`).first().screenshot('sr24-card');
    });
  });
  it('records list', () => {
    includeSeededDoctorsInProviderList();
    signInAsScheduling('cl', '/schedule/scheduling-tools/records');
    cy.wait(5000);
    dump('sr25-list', 'body');
    cy.screenshot('sr25-list', { capture: 'viewport' });
  });
});

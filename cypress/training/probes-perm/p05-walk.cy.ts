/// <reference types="cypress" />
/** Walks the PERM scripts' real actions as the Practice Admin, then the views other roles get. Test stack only. */
import '../../support/e2e';
import { dumpPage, signInAsPerm } from './permKit';

const shot = (n: string) => { dumpPage(n); cy.screenshot(n, { capture: 'viewport' }); };
function pickStaff(name: string) {
  cy.get('select').filter((_, el) => Array.from((el as HTMLSelectElement).options).some((o) => o.text.includes(name))).first().then(($s) => {
    const opt = Array.from(($s[0] as HTMLSelectElement).options).find((o) => o.text.includes(name))!;
    cy.wrap($s).select(opt.value);
  });
  cy.wait(2500);
}
const tab = (label: string) => { cy.get('[role="tab"]').contains(new RegExp(`^${label}$`)).click(); cy.wait(2500); };
const ymd = (days: number) => new Date(Date.now() + days * 86400000).toLocaleDateString('en-CA');

describe('Permissions walk', () => {
  it('PERM-02 give Sam Chen Technician at Raleigh', () => {
    signInAsPerm('practice_admin', '/schedule/settings?tab=roles');
    cy.wait(5000);
    cy.contains('button', /^Technician/).click();
    cy.wait(3000);
    shot('w02-technician');
    cy.contains('div', /^Raleigh office$/).parent().contains('label', 'Sam Chen').find('input').check();
    cy.contains('button', 'Save assignees').click();
    cy.wait(4000);
    shot('w02-saved');
  });

  it('PERM-03 license, PERM-06 grant', () => {
    signInAsPerm('practice_admin', '/schedule/settings?tab=employee-directory');
    cy.wait(5000);
    pickStaff('Sam Chen');
    tab('Access');
    shot('w03-sam-access-before');
    cy.contains('label', 'Licensed technician').find('input').check();
    cy.wait(4000);
    shot('w03-sam-access-after');
    pickStaff('Lou Bennett');
    tab('Access');
    cy.contains('.label', 'Permission').parent().find('select').then(($s) => {
      const opt = Array.from(($s[0] as HTMLSelectElement).options).find((o) => o.text.includes('Cancel a membership'))!;
      cy.wrap($s).select(opt.value);
    });
    cy.contains('.label', 'Ends (optional)').parent().find('input').type(ymd(14));
    cy.contains('button', /^Grant$/).click();
    cy.wait(1500);
    shot('w06-reason');
    cy.contains('button', 'Covering while manager is away').click();
    cy.get('[role="dialog"]').contains('button', /^Grant$/).click();
    cy.wait(4000);
    shot('w06-granted');
  });

  it('PERM-04 offboard Riley, PERM-05 audit, PERM-07 editor', () => {
    signInAsPerm('practice_admin', '/schedule/settings?tab=employee-directory');
    cy.wait(5000);
    pickStaff('Riley Rivera');
    cy.contains('button', /^Offboard$/).scrollIntoView().click();
    cy.wait(3000);
    cy.get('input[aria-label="Last day"]').clear().type(ymd(4));
    cy.wait(3000);
    cy.get('select[aria-label="Their tasks go to"]').select('Maya Ortiz');
    cy.get('select[aria-label="New primary doctor"]').select('Maya Ortiz');
    cy.get('select[aria-label="Tess Holt works with"]').then(($s) => {
      const opt = Array.from(($s[0] as HTMLSelectElement).options).find((o) => o.text.includes('Maya Ortiz'))!;
      cy.wrap($s).select(opt.value);
    });
    shot('w04-filled');
    cy.get('[role="dialog"]').contains('button', /^Offboard$/).click();
    cy.wait(5000);
    shot('w04-done');
    cy.visit('/schedule/settings?tab=permission-audit');
    cy.wait(5000);
    shot('w05-audit');
    cy.visit('/schedule/settings?tab=roles');
    cy.wait(5000);
    cy.contains('button', /^Client Liaison/).click();
    cy.wait(3000);
    cy.get('input[placeholder="Search permissions"]').type('deposit');
    cy.wait(1000);
    shot('w07-deposit');
    cy.get('input[placeholder="Search permissions"]').clear().type('export');
    cy.wait(1000);
    shot('w07-export');
  });

  it('PERM-01/ROLE-01 manager views', () => {
    signInAsPerm('practice_manager', '/schedule/settings?tab=employee-directory');
    cy.wait(5000);
    pickStaff('Tess Holt');
    tab('Access');
    shot('w01-pm-tess-access');
    cy.visit('/schedule/settings?tab=roles');
    cy.wait(5000);
    cy.contains('button', /^Client Liaison/).click();
    cy.wait(3000);
    shot('w01-pm-roles-cl');
    cy.visit('/schedule/analytics/vsd');
    cy.wait(5000);
    shot('w01-pm-vsd');
  });

  it('ROLE-03/06/05 views', () => {
    signInAsPerm('veterinarian', '/schedule/analytics/vsd');
    cy.wait(6000);
    shot('w03r-vet-vsd');
    signInAsPerm('inventory_manager', '/schedule/inventory/counts');
    cy.wait(6000);
    shot('w06r-im-pharmacy');
    cy.visit('/schedule/settings');
    cy.wait(5000);
    shot('w06r-im-settings');
    signInAsPerm('lead_client_liaison', '/schedule/settings');
    cy.wait(5000);
    shot('w05r-lcl-settings');
    signInAsPerm('medical_director', '/schedule/settings?tab=employee-directory');
    cy.wait(5000);
    shot('w02r-md-staff');
  });
});

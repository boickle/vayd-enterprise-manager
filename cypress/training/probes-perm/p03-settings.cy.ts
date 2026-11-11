/// <reference types="cypress" />
import '../../support/e2e';
import { dumpPage, signInAsPerm, PermKey } from './permKit';

function pickStaff(name: string) {
  cy.get('select').filter((_, el) => Array.from((el as HTMLSelectElement).options).some((o) => o.text.includes(name))).first().then(($s) => {
    const opt = Array.from(($s[0] as HTMLSelectElement).options).find((o) => o.text.includes(name))!;
    cy.wrap($s).select(opt.value);
  });
  cy.wait(2500);
}
function tab(label: string) {
  cy.get('[role="tab"]').contains(new RegExp(`^${label}$`)).click();
  cy.wait(2500);
}
const shot = (n: string) => { dumpPage(n); cy.screenshot(n, { capture: 'viewport' }); };

function walk(who: PermKey) {
  signInAsPerm(who, '/schedule/settings?tab=employee-directory');
  cy.wait(5000);
  shot(`st-${who}-staff`);
  pickStaff('Riley Rivera');
  shot(`st-${who}-riley-profile`);
  tab('Access');
  shot(`st-${who}-riley-access`);
  tab('Profile');
  cy.get('body').then(($b) => {
    if ($b.find('button').filter((_, el) => el.innerText.trim() === 'Offboard').length) {
      cy.contains('button', /^Offboard$/).scrollIntoView().click();
      cy.wait(3000);
      shot(`st-${who}-riley-offboard`);
      cy.get('input[aria-label="Last day"]').then(($i) => {
        const d = new Date(Date.now() + 5 * 86400000).toLocaleDateString('en-CA');
        cy.wrap($i).clear().type(d);
      });
      cy.wait(3000);
      shot(`st-${who}-riley-offboard-lastday`);
      cy.get('[role="dialog"]').contains('button', /^Cancel$/).click();
    }
  });
  pickStaff('Sam Chen');
  shot(`st-${who}-sam-profile`);
  tab('Access');
  shot(`st-${who}-sam-access`);
  pickStaff(who === 'practice_admin' ? 'Quinn Parker' : 'Jamie Brooks');
  tab('Access');
  shot(`st-${who}-self-access`);
  cy.visit('/schedule/settings?tab=roles');
  cy.wait(5000);
  shot(`st-${who}-roles`);
  cy.visit('/schedule/settings?tab=permission-audit');
  cy.wait(5000);
  shot(`st-${who}-audit`);
}

describe('Permissions probe: Settings staff screens', () => {
  it('practice admin', () => walk('practice_admin'));
  it('practice manager', () => walk('practice_manager'));
});

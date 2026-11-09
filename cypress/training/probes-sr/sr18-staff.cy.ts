/// <reference types="cypress" />
import '../../support/e2e';
import { signInAsScheduling } from '../../support/schedulingWorld';
import { dump } from './srKit';

describe('SR-18 probe', () => {
  it('staff schedule', () => {
    signInAsScheduling('admin' as any, '/settings');
    cy.contains('button', /^Staff$/, { timeout: 60000 }).first().click();
    cy.wait(800);
    cy.get('button').filter((_, el) => el.innerText.trim() === 'Staff').last().click();
    cy.wait(4000);
    dump('sr18-staff', 'body');
    cy.screenshot('sr18-staff', { capture: 'viewport' });
    cy.get('select').filter((_, el) => Array.from((el as HTMLSelectElement).options).some((o) => /Avery Lane/.test(o.text))).first().then(($s) => {
      const opt = Array.from(($s[0] as HTMLSelectElement).options).find((o) => /Avery Lane/.test(o.text))!;
      cy.wrap($s).select(opt.value);
    });
    cy.wait(3000);
    cy.contains('button, [role="tab"]', /^Schedule$/).click();
    cy.wait(4000);
    dump('sr18-schedule', 'body');
    cy.screenshot('sr18-schedule', { capture: 'viewport' });
    cy.contains('button', /Date overrides/).click();
    cy.wait(3000);
    dump('sr18-overrides', 'body');
    cy.screenshot('sr18-overrides', { capture: 'viewport' });
  });
});

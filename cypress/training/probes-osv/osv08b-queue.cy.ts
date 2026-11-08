/// <reference types="cypress" />
/** OSV-08/09/10 probe: expand queue rows and record what each stage offers (labels + screenshots). */
import '../../support/e2e';
import { labels, shot, signIn } from './osvKit';

const expand = (orderNo: string) => {
  cy.get('input[placeholder*="Order #"]', { timeout: 30000 }).clear().type(orderNo.replace('#', ''));
  cy.wait(2500);
  cy.contains(orderNo).first().click({ force: true });
  cy.wait(3000);
};

describe('OSV queue stages', () => {
  it('Riley: #273 Maple heartworm (fill) and #272 chews', () => {
    signIn('mailteam', '/schedule/mail-orders');
    cy.contains('Mail Order Queue', { timeout: 40000 });
    labels('q-00-queue-riley');
    expand('#273');
    shot('q-01-273-open');
    labels('q-01-273-open');
    cy.get('body').then(($b) => {
      const sels = [...$b.find('select:visible')].map((s) => ({
        label: (s.closest('label')?.innerText || s.getAttribute('aria-label') || '').trim().slice(0, 60),
        options: [...(s as HTMLSelectElement).options].map((o) => o.text).slice(0, 8),
      }));
      cy.writeFile(`${Cypress.env('OSV_OUT')}/labels/q-01-273-selects.json`, sels);
    });
    expand('#272');
    shot('q-02-272-open');
    labels('q-02-272-open');
  });

  it('Robin: #275 Juniper thyroid (needs approval)', () => {
    signIn('manager', '/schedule/mail-orders');
    cy.contains('Mail Order Queue', { timeout: 40000 });
    expand('#275');
    shot('q-03-275-open');
    labels('q-03-275-open');
  });
});

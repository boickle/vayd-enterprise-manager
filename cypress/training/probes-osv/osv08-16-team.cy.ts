/// <reference types="cypress" />
/** OSV-08 to 16 probe: fill, check, label (Riley, then Robin checks), cancel and refund (Robin), Auto-ships,
 *  gift cards, listing, coupons. Exploratory: screenshots at each step; clicks only buttons that exist. */
import '../../support/e2e';
import { osv, shot, signIn } from './osvKit';

const clickIf = (re: RegExp, name?: string) =>
  cy.get('body').then(($b) => {
    const btn = $b.find('button:visible').filter((_, el) => re.test(el.innerText.trim()) && !(el as HTMLButtonElement).disabled);
    if (btn.length) {
      cy.wrap(btn.first()).scrollIntoView().click();
      cy.wait(2500);
      if (name) shot(name);
    } else {
      cy.log(`no enabled button ${re}`);
      if (name) shot(`${name}-MISSING`);
    }
  });

const openOrder = (text: RegExp) => {
  cy.get('input[placeholder*="Order #"]', { timeout: 30000 }).clear().type('Rivera');
  cy.wait(2500);
  cy.contains(text).first().click({ force: true });
  cy.wait(2500);
};

describe('OSV-08 to 16 team', () => {
  it('OSV-08/09: Riley fills Maple joint chews; Robin checks; label', () => {
    signIn('mailteam', '/schedule/mail-orders');
    cy.contains('Mail Order Queue', { timeout: 40000 });
    cy.contains('button', /^Fill$/).click();
    cy.wait(2500);
    shot('osv08-01-fill-tab');
    openOrder(/Joint support chews/);
    shot('osv08-02-order-open');
    clickIf(/^Mark filled$|^Finish filling$/, 'osv08-03-after-fill-click');
    clickIf(/^Mark filled$|^Finish filling$/, 'osv08-04-after-fill-click-2');
    signIn('manager', '/schedule/mail-orders');
    cy.contains('Mail Order Queue', { timeout: 40000 });
    cy.contains('button', /^Check$/).click();
    cy.wait(2500);
    shot('osv08-05-check-tab');
    openOrder(/Joint support chews/);
    shot('osv08-06-check-open');
    clickIf(/^Check all remaining$/, 'osv08-07-checked');
    clickIf(/^Checked$|^Mark checked$|^Passed/, 'osv08-08-passed');
    cy.contains('button', /^Ship \/ pickup$/).click();
    cy.wait(2500);
    shot('osv09-01-ship-tab');
    openOrder(/Joint support chews/);
    shot('osv09-02-ship-open');
    cy.get('body').then(($b) => {
      const w = $b.find('input').filter((_, el) => /oz|weight/i.test((el as HTMLInputElement).placeholder + (el.getAttribute('aria-label') || '')));
      if (w.length) cy.wrap(w.first()).clear().type('12');
    });
    clickIf(/^Get cheapest rates$/, 'osv09-03-rates');
    clickIf(/^Print cheapest label$/, 'osv09-04-label');
  });

  it('OSV-10: Robin cancels and refunds the dental chews order', () => {
    signIn('manager', '/schedule/mail-orders');
    cy.contains('Mail Order Queue', { timeout: 40000 });
    cy.contains('button', /^All$/).click();
    cy.wait(2000);
    openOrder(/Dental chews/);
    shot('osv10-01-order');
    clickIf(/^Cancel order$/, 'osv10-02-cancel-dialog');
  });

  it('OSV-11: Auto-ships list as Riley and as Robin', () => {
    signIn('mailteam', '/schedule/inventory/auto-ships');
    cy.contains('Auto-ships', { timeout: 40000 });
    cy.wait(2500);
    shot('osv11-01-list-riley');
    clickIf(/^Payment problems$/, 'osv11-02-problems');
    clickIf(/^Active$/);
    clickIf(/^Edit$/, 'osv11-03-edit-riley');
    signIn('manager', '/schedule/inventory/auto-ships');
    cy.contains('Auto-ships', { timeout: 40000 });
    cy.wait(2500);
    clickIf(/^Edit$/, 'osv11-04-edit-robin');
  });

  it('OSV-14/15/16: gift cards, listing, coupons as Robin', () => {
    signIn('manager', '/schedule/inventory/gift-cards');
    cy.contains(/Sold gift cards|Gift cards/i, { timeout: 40000 });
    cy.wait(2500);
    shot('osv14-01-gift-cards');
    clickIf(/^Issue a gift card$/, 'osv14-02-issue');
    signIn('manager', '/schedule/inventory/online-store');
    cy.wait(6000);
    shot('osv16-01-online-store');
    signIn('manager', `/schedule/inventory/items?itemId=${osv().items.joint}`);
    cy.wait(6000);
    shot('osv15-01-catalog');
  });
});

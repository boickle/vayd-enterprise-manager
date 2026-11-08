/// <reference types="cypress" />
/** Q8 walk (Nov 8): Riley fills thyroid order #273 (lot-tracked, lot TH24117 in the Raleigh office): stock source,
 *  "Needs a lot", lot picker, Mark filled. Screenshots and labels only; clicks only what exists. */
import '../../support/e2e';
import { labels, shot, signIn, sql } from './osvKit';

describe('Q8 lot picking', () => {
  it('Riley fills the thyroid order and picks lot TH24117', () => {
    signIn('mailteam', '/schedule/mail-orders');
    cy.contains('Mail Order Queue', { timeout: 40000 });
    cy.contains('button', /^Fill$/).click();
    cy.wait(2500);
    cy.get('input[placeholder*="Order #"]', { timeout: 30000 }).clear().type('273');
    cy.wait(2500);
    cy.contains('#273').first().click({ force: true });
    cy.wait(3000);
    cy.contains(/LOT \/ EXPIRATION/i).scrollIntoView({ offset: { top: -250, left: 0 } });
    cy.wait(800);
    shot('lot-01-order-open');
    labels('lot-01-order-open');
    cy.contains('button', /^Add lot$/).click();
    cy.wait(2000);
    cy.contains(/LOT \/ EXPIRATION/i).scrollIntoView({ offset: { top: -250, left: 0 } });
    shot('lot-02-add-lot');
    labels('lot-02-add-lot');
    cy.get('body').then(($b) => {
      const sel = $b.find('select:visible').filter((_, el) => [...(el as HTMLSelectElement).options].some((o) => /TH24117/.test(o.text)));
      if (sel.length) {
        const opt = [...(sel[0] as HTMLSelectElement).options].find((o) => /TH24117/.test(o.text))!;
        cy.wrap(sel.first()).select(opt.value);
      } else {
        const item = $b.find(':visible').filter((_, el) => el.children.length === 0 && /TH24117/.test(el.textContent || ''));
        if (item.length) cy.wrap(item.first()).click({ force: true });
        else cy.log('no TH24117 option');
      }
    });
    cy.wait(2000);
    cy.contains(/LOT \/ EXPIRATION/i).scrollIntoView({ offset: { top: -250, left: 0 } });
    shot('lot-03-lot-picked');
    labels('lot-03-lot-picked');
    cy.get('body').then(($b) => {
      const sel = $b.find('select').map((_, el) => [...(el as HTMLSelectElement).options].map((o) => o.text).join(' | ')).get();
      cy.writeFile(`${Cypress.env('OSV_OUT')}/labels/lot-selects.json`, sel);
    });
    sql(`SELECT coalesce(string_agg(l.id || ':' || coalesce(l."lineStatus",'') , ','), '') FROM mail_order_lines l WHERE l."mailOrderId" = 273`).then((o) => cy.writeFile(`${Cypress.env('OSV_OUT')}/labels/lot-lines.txt`, o));
  });
});

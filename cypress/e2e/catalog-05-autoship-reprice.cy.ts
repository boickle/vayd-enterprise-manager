/// <reference types="cypress" />
import '../support/e2e';
import { catalogWorld, signInAsCatalog } from '../support/catalogWorld';
import { plainClient, sql } from '../support/catalogUi';

/**
 * CAT-05-7: screen to email. A manager changes a store price from $40 to $44 in Catalog and confirms the
 * auto-ship warning; the price check job then updates fake Stripe once per auto-ship, emails each client once
 * (captured to a file, never sent), and defers the increase at least 3 days.
 *
 * Needs: the API started with STRIPE_API_BASE on the fake Stripe and the email capture preload, and
 * CYPRESS_STRIPE_LOG / CYPRESS_EMAIL_CAPTURE_PATH / CYPRESS_E2E_API_DIR (see test/scripts/e2e-*.js in vayd-api).
 */
const iso = (daysAhead: number) => {
  const d = new Date(Date.now() + daysAhead * 864e5);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const lines = (text: string) => text.split('\n').filter(Boolean).map((l) => JSON.parse(l));

describe('CAT-05-7: store price change reaches auto-ships and clients once', () => {
  it('warns, reprices each auto-ship once, emails each client once, defers the increase', () => {
    const w = catalogWorld();
    const stripeLog = Cypress.env('STRIPE_LOG') as string;
    const mailLog = Cypress.env('EMAIL_CAPTURE_PATH') as string;
    const apiDir = (Cypress.env('E2E_API_DIR') as string) || '../api-cat-all';
    const preload = `${apiDir}/test/scripts/e2e-capture-preload.js`;
    const stamp = Date.now();
    const itemId = w.items.storeId;
    expect(stripeLog, 'CYPRESS_STRIPE_LOG').to.be.a('string');

    // The practice runs an online store (Settings, Inventory), so the item's Online Store tab shows.
    sql(`UPDATE practice_settings SET value = 'true' WHERE "practiceId" = ${w.practiceId} AND key = 'inventory.onlineStoreImplemented'`);
    sql(
      `INSERT INTO practice_settings ("practiceId", key, value) SELECT ${w.practiceId}, 'inventory.onlineStoreImplemented', 'true'
       WHERE NOT EXISTS (SELECT 1 FROM practice_settings WHERE "practiceId" = ${w.practiceId} AND key = 'inventory.onlineStoreImplemented')`
    );
    // Exactly two live auto-ships on the store item, each for its own client, due in 2 days.
    sql(`UPDATE online_store_subscriptions SET active = false WHERE "inventoryItemId" = ${itemId}`);
    sql(`UPDATE inventory_items SET price = 40, "onlineStorePrice" = 40 WHERE id = ${itemId}`);
    const subs: Array<{ name: string; email: string; stripeId: string }> = [];
    const makeSub = (label: string) =>
      plainClient(`${label}${stamp}`).then((who) => {
        const name = `Zed${label}${stamp}`.replace(/[0-9]/g, (d) => 'abcdefghij'[Number(d)]);
        const stripeId = `sub_${w.tag}_${label}_${stamp}`;
        const email = `${w.tag}-${label}-${stamp}@vayd.test`;
        return sql(
          `INSERT INTO online_store_subscriptions ("practiceId","inventoryItemId","clientId","patientId","customerEmail",frequency,"renewalDate","stripeSubscriptionId",active,"itemName",quantity,"unitPrice","taxRate","customerName")
           VALUES (${w.practiceId}, ${itemId}, ${who.clientId}, ${who.patientId}, '${email}', 'every_3_months', '${iso(2)}', '${stripeId}', true, '${w.tag} store item', 1, 40, 0, '${name}')`
        ).then(() => {
          subs.push({ name, email, stripeId });
        });
      });
    makeSub('alpha');
    makeSub('beta');

    cy.readFile(stripeLog).then((t: string) => cy.wrap(lines(t).length).as('stripeBefore'));
    cy.readFile(mailLog).then((t: string) => cy.wrap(lines(t).length).as('mailBefore'));

    signInAsCatalog('practice_manager', '/schedule/inventory/items');
    cy.get('input[placeholder^="Search products"]', { timeout: 30000 }).type(`${w.tag} store item`);
    cy.contains('td', `${w.tag} store item`, { timeout: 20000 }).click();
    cy.contains('button', 'Online Store', { timeout: 15000 }).click();
    cy.contains('label', 'Online store price').find('input').clear().type('44');
    cy.contains('button', 'Save online store details').click();
    cy.contains('Reprice auto-ships?', { timeout: 15000 });
    cy.contains('2 auto-ships will be repriced and those clients emailed within the hour');
    cy.contains('button', 'Save price').click();
    cy.wait(2500);
    sql(`SELECT "onlineStorePrice" FROM inventory_items WHERE id = ${itemId}`).then((v) => expect(Number(v)).to.eq(44));

    // The hourly price check, run now.
    cy.exec(`cd ${apiDir} && node test/scripts/catalog-e2e-job.js`, {
      timeout: 240000,
      env: {
        DB_DATABASE: Cypress.env('E2E_DB') || 'vayd_api_test_e2e',
        MIGRATION_DB_NAME: Cypress.env('E2E_DB') || 'vayd_api_test_e2e',
        STRIPE_API_BASE: Cypress.env('STRIPE_API_BASE') || 'http://127.0.0.1:4010',
        EMAIL_CAPTURE_PATH: mailLog,
        E2E_API_DIR: apiDir,
        NOTIFY_DRY_RUN: '1',
        NODE_OPTIONS: `--max-old-space-size=4096 --require ${preload}`,
      },
    })
      .its('stdout')
      .should('contain', 'price check done');

    cy.get<number>('@stripeBefore').then((before) => {
      cy.readFile(stripeLog).then((t: string) => {
        const fresh = lines(t).slice(before);
        for (const s of subs) {
          const updates = fresh.filter((r) => r.method === 'POST' && r.url === `/v1/subscriptions/${s.stripeId}`);
          expect(updates, `Stripe updates for ${s.stripeId}`).to.have.length(1);
          const trialEnd = Number(new URLSearchParams(updates[0].body).get('trial_end'));
          expect(trialEnd, 'increase deferred').to.be.at.least(Math.floor(Date.now() / 1000) + 2.5 * 86400);
        }
      });
    });
    cy.get<number>('@mailBefore').then((before) => {
      cy.readFile(mailLog).then((t: string) => {
        const fresh = lines(t).slice(before);
        for (const s of subs) {
          const mine = fresh.filter((m) => JSON.stringify(m).includes(s.name));
          expect(mine, `emails naming ${s.name}`).to.have.length(1);
          expect(JSON.stringify(mine[0])).to.match(/\$?44(\.00)?/);
        }
      });
    });
    sql(`SELECT count(*) FROM online_store_subscriptions WHERE "inventoryItemId" = ${itemId} AND active AND "unitPrice" = 44 AND "renewalDate" >= '${iso(3)}'`).then((n) => expect(n).to.eq('2'));
  });
});

/// <reference types="cypress" />
/**
 * Shared setup for the Online Store training videos (OSV-*). TEST stack only, Stripe TEST mode.
 * Needs CYPRESS_OSV_WORLD (the JSON that setup/online-store-demo.cjs writes) besides record.sh's usual variables.
 */
import { schedulingWorld, signInAsScheduling, type SchRole } from '../support/schedulingWorld';
import { pointAt, tap } from './trainingKit';

export type OsvWorld = {
  items: { chews: number; joint: number; hw: number; thyroid: number; gaba: number; giftItem: number };
  pets: { maple: number; juniper: number; biscuit: number };
  clients: { rivera: number; chen: number };
  employees: { riley: number; robin: number; lane: number };
  giftCard: { code: string; balance: number };
  auth: {
    mailteam: { token: string; Authorization: string };
    chen: { token: string; Authorization: string };
    billing: { token: string; Authorization: string };
  };
};

export const osv = (): OsvWorld => {
  const raw = Cypress.env('OSV_WORLD') as string | OsvWorld;
  if (!raw) throw new Error('Set CYPRESS_OSV_WORLD to the online-store-demo.cjs output');
  return typeof raw === 'string' ? (JSON.parse(raw) as OsvWorld) : raw;
};

const testDb = () => {
  const name = String(Cypress.env('SCH_DB'));
  expect(name, 'CYPRESS_SCH_DB must be a vayd_api_test* database').to.match(/^vayd_api_test[A-Za-z0-9_]*$/);
  return name;
};

/** One SQL statement on the TEST database; yields stdout. */
export const sql = (q: string) =>
  cy.exec(`PGPASSWORD=vayd psql -h localhost -U vayd -qAt -d ${testDb()} -c "${q.replace(/"/g, '\\"')}"`, { log: false }).its('stdout');

/** Sign in as a seeded role, or as Riley Brooks (mailteam), Morgan Ellis (billing) or Tom Chen (chen). Clears the local cart too. */
export function signIn(role: SchRole | 'mailteam' | 'billing' | 'chen', path: string) {
  if (role === 'mailteam' || role === 'billing' || role === 'chen') {
    const t = osv().auth[role].token;
    cy.visit('/login');
    cy.window().then((win) => {
      win.localStorage.clear();
      win.localStorage.setItem('accessToken', t);
      if (role === 'chen') win.localStorage.setItem('vayd_clientId', String(osv().clients.chen));
    });
    cy.visit(path);
    return;
  }
  signInAsScheduling(role, path);
}

/** Logged out, with an empty local cart. */
export function asGuest(path: string) {
  cy.visit('/login');
  cy.window().then((win) => win.localStorage.clear());
  cy.visit(path);
}

const stripeInput = (name: string) =>
  cy
    .get('.vayd-store__card-box iframe', { timeout: 30000 })
    .its('0.contentDocument.body')
    .should('not.be.empty')
    .then(cy.wrap)
    .find(`input[name="${name}"]`, { timeout: 30000 });

/** Points at the card box, then types Stripe's test Visa (or `number`) and fills any empty billing fields. */
export function enterTestCard(number = '4242424242424242', nameOnCard?: string) {
  pointAt(() => cy.get('.vayd-store__card-box'), 4000);
  cy.get('body').then(($b) => {
    const el = $b.find('input[autocomplete="cc-name"]');
    if (nameOnCard && el.length && !String(el.val() ?? '').trim()) cy.wrap(el.first()).type(nameOnCard, { delay: 40 });
  });
  stripeInput('cardnumber').type(number, { delay: 30 });
  stripeInput('exp-date').type('1234', { delay: 30 });
  stripeInput('cvc').type('123', { delay: 30 });
  cy.get('.vayd-store__card-box iframe')
    .its('0.contentDocument.body')
    .then(($body) => {
      if (Cypress.$($body).find('input[name="postal"]').length) stripeInput('postal').type('27601', { delay: 30 });
    });
  const fields: Array<[string, string]> = [
    ['billing address-line1', '100 Test Lane'],
    ['billing address-level2', 'Raleigh'],
    ['billing address-level1', 'NC'],
    ['billing postal-code', '27601'],
  ];
  for (const [ac, value] of fields) {
    cy.get('body').then(($b) => {
      const el = $b.find(`input[autocomplete="${ac}"]`);
      if (el.length && !String(el.val() ?? '').trim()) cy.wrap(el.first()).type(value, { delay: 30 });
    });
  }
}

/** Clear what earlier takes left on the Riveras and Chens: store orders, auto-ships, carts and saved Stripe cards. */
export function resetStoreData() {
  const o = osv();
  const clients = `${o.clients.rivera},${o.clients.chen}`;
  sql(`UPDATE online_store_subscriptions SET active=false WHERE "clientId" IN (${clients})`);
  // Deleted, not cancelled: the queue counts cancelled orders as rejected ones still waiting for a call (TEST database only).
  sql(`DELETE FROM mail_orders WHERE "clientId" IN (${clients}) OR "clientId" IS NULL`);
  sql(`UPDATE clients SET "stripeCustomerId"=NULL, "savedPaymentMethodId"=NULL WHERE id IN (${clients})`);
  // Earlier fills used up the demo lot: back to 6 on the shelf.
  sql(`UPDATE inventory_lot_balances SET "quantityOnHand"=6 WHERE "inventoryItemId"=${o.items.thyroid} AND "lotNumber"='TH24117'`);
}

/**
 * Setup (before startClock, plain clicks): Maria buys one item in the store for a pet and pays with the test Visa
 * (saving it). `tab` is the store tab that lists the item. Yields the new order id.
 */
export function buyAsMaria(o: { tab: string; item: string; pet: string; autoship: boolean; qty?: number }) {
  signIn('client', '/store');
  cy.contains('button', new RegExp(`^${o.tab}$`), { timeout: 30000 }).click();
  cy.contains('a.vayd-store__card', o.item, { timeout: 30000 }).click();
  cy.contains('button', new RegExp(`^${o.pet}$`), { timeout: 20000 }).click();
  cy.contains('button', o.autoship ? /^Auto-ship/ : /^Buy once$/).click();
  for (let i = 1; i < (o.qty ?? 1); i += 1) cy.get('button[aria-label="Increase quantity"]').click();
  cy.contains('button', /^Add to cart$/).click();
  cy.contains(/Added to cart/i, { timeout: 15000 });
  cy.intercept('GET', '**/clients/*').as('clientDetails');
  cy.visit('/store/cart');
  cy.wait('@clientDetails', { timeout: 30000 });
  cy.wait(1000);
  // Wait until the cart shows either Maria's saved card or the card fields, then fill only what's needed.
  cy.get('body', { timeout: 30000 }).should(($b) => {
    expect($b.text().includes('Card on file') || $b.find('.vayd-store__card-box iframe').length > 0).to.eq(true);
  });
  cy.wait(800);
  cy.get('body').then(($b) => {
    if ($b.text().includes('Yes — send it here')) cy.contains('label', 'Yes — send it here').click();
    if (!$b.text().includes('Card on file')) enterTestCard('4242424242424242', 'Maria Rivera');
  });
  cy.contains('button', /^Place order$/).should('not.be.disabled').click();
  cy.contains('h1', 'Thank you', { timeout: 60000 });
  return cy.location('pathname').then((p) => Number(p.split('/').pop()));
}

/**
 * Setup: Maria buys one bottle of Juniper's thyroid tablets (no refills left), Robin sends the approval task to Dr. Lane,
 * and Dr. Lane approves it through the API. Yields the order id; the order is then ready to fill.
 */
export function approvedThyroidOrder() {
  const w = schedulingWorld();
  return buyAsMaria({ tab: 'Prescriptions', item: 'Thyroid tablets', pet: 'Juniper', autoship: false }).then((orderId) =>
    sql(`SELECT id FROM mail_order_lines WHERE "mailOrderId"=${orderId} ORDER BY id LIMIT 1`).then((lineIdText) => {
      const lineId = Number(String(lineIdText).trim());
      const base = `${Cypress.env('API_URL')}/practice/${w.practiceId}/mail-orders/${orderId}`;
      cy.request({ method: 'POST', url: `${base}/approval-task`, headers: { Authorization: w.auth.manager.Authorization },
        body: { assignedToEmployeeId: osv().employees.lane } });
      cy.request({ method: 'POST', url: `${base}/approval-response`, headers: { Authorization: w.auth.doctorA.Authorization },
        body: {
          outcome: 'approved',
          lineRefills: [{ lineId, refills: 0, expiration: new Date(Date.now() + 200 * 86400000).toISOString().slice(0, 10), acuity: 'chronic' }],
          lineScripts: [{ lineId, scriptText: 'Give one tablet by mouth twice daily.' }],
        } });
      return cy.wrap(orderId);
    })
  );
}

/** Mail Order Queue: switching filters sometimes keeps the order open, sometimes not. Opens it only when it's closed. */
export function openOrderIfClosed(orderId: () => number) {
  cy.wait(400).then(() => {
    if (!Cypress.$('body').text().includes('Reject + refund + email')) tap(() => cy.contains(`#${orderId()}`, { timeout: 20000 }).first());
  });
}

/** Scrolls the element to the middle at once and lets the page settle, so the outline lands on it (tall portal pages). */
function settle(get: () => Cypress.Chainable<JQuery<HTMLElement>>) {
  get().then(($el) => $el[0].scrollIntoView({ block: 'center' }));
  cy.wait(250, { log: false });
}
/** pointAt, after the page has settled. */
export function look(get: () => Cypress.Chainable<JQuery<HTMLElement>>, outlineMs = 2500) {
  settle(get);
  pointAt(get, outlineMs);
}
/** tap, after the page has settled. */
export function press(get: () => Cypress.Chainable<JQuery<HTMLElement>>) {
  settle(get);
  tap(get);
}

export { schedulingWorld };

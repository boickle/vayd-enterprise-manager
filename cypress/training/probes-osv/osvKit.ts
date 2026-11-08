/// <reference types="cypress" />
/** Shared helpers for the Online Store (OSV) probes: no voice, screenshots only. Local, not committed. */
import { schedulingWorld, signInAsScheduling, type SchRole } from '../../support/schedulingWorld';

export type OsvWorld = {
  items: { chews: number; joint: number; hw: number; thyroid: number; gaba: number; giftItem: number };
  pets: { maple: number; juniper: number; biscuit: number };
  clients: { rivera: number; chen: number };
  employees: { riley: number; robin: number; lane: number };
  giftCard: { code: string; balance: number };
  auth: { mailteam: { token: string; Authorization: string }; chen: { token: string; Authorization: string } };
};

export const osv = (): OsvWorld => {
  const raw = Cypress.env('OSV_WORLD') as string | OsvWorld;
  return typeof raw === 'string' ? (JSON.parse(raw) as OsvWorld) : raw;
};

export const db = () => {
  const name = String(Cypress.env('SCH_DB'));
  expect(name).to.match(/^vayd_api_test[A-Za-z0-9_]*$/);
  return name;
};
export const sql = (q: string) => cy.exec(`PGPASSWORD=vayd psql -h localhost -U vayd -qAt -d ${db()} -c "${q.replace(/"/g, '\\"')}"`).its('stdout');

/** Sign in as a seeded role, or as the OSV extra logins (mailteam = Riley Brooks, chen = Tom Chen). */
export function signIn(role: SchRole | 'mailteam' | 'chen', path: string) {
  if (role === 'mailteam' || role === 'chen') {
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

export const shot = (name: string) => {
  cy.wait(800);
  cy.screenshot(name, { capture: 'fullPage', overwrite: true });
};

export const stripeField = (name: string, value: string) =>
  cy
    .get('.vayd-store__card-box iframe', { timeout: 30000 })
    .its('0.contentDocument.body')
    .should('not.be.empty')
    .then(cy.wrap)
    .find(`input[name="${name}"]`, { timeout: 30000 })
    .clear()
    .type(value);

export const enterCard = (number = '4242424242424242') => {
  stripeField('cardnumber', number);
  stripeField('exp-date', '1234');
  stripeField('cvc', '123');
  cy.get('.vayd-store__card-box iframe')
    .its('0.contentDocument.body')
    .then(($body) => {
      if (Cypress.$($body).find('input[name="postal"]').length) stripeField('postal', '27601');
    });
  const fields: Array<[string, string]> = [
    ['billing address-line1', '214 Oak Hollow Lane'],
    ['billing address-level2', 'Raleigh'],
    ['billing address-level1', 'NC'],
    ['billing postal-code', '27601'],
  ];
  for (const [ac, value] of fields) {
    cy.get('body').then(($b) => {
      const el = $b.find(`input[autocomplete="${ac}"]`);
      if (el.length && !String(el.val() ?? '').trim()) cy.wrap(el.first()).type(value);
    });
  }
  cy.wait(1500);
};

export { schedulingWorld };

/** Open the cart and wait until it has loaded the client's details (Place order before that says "Enter the name and email"). */
export const visitCart = () => {
  cy.intercept('GET', '**/clients/*').as('clientDetails');
  cy.visit('/store/cart');
  cy.wait('@clientDetails', { timeout: 30000 });
  cy.wait(1000);
};

/** Record the visible buttons, headings and status chips (for scripts: exact labels) to <OSV_OUT>/labels/<name>.json. */
export const labels = (name: string) =>
  cy.get('body').then(($b) => {
    const txt = (sel: string) =>
      [...$b.find(sel)]
        .filter((el) => (el as HTMLElement).offsetParent !== null)
        .map((el) => ({ t: (el as HTMLElement).innerText.trim().replace(/\s+/g, ' '), d: (el as HTMLButtonElement).disabled || undefined }))
        .filter((x) => x.t && x.t.length < 90);
    cy.writeFile(`${Cypress.env('OSV_OUT')}/labels/${name}.json`, {
      buttons: txt('button'),
      headings: txt('h1,h2,h3,h4,legend,label'),
    });
  });

/** Record failed API replies (status >= 400, except permissions/me) and write them on demand. */
export const recordFails = () => {
  const fails: Array<{ m: string; u: string; s: number; b: unknown }> = [];
  cy.intercept({ url: `${Cypress.env('API_URL')}/**` }, (req) => {
    req.on('response', (res) => {
      if (res.statusCode >= 400 && !/permissions\/me/.test(req.url)) fails.push({ m: req.method, u: req.url.replace(/^https?:\/\/[^/]+/, ''), s: res.statusCode, b: res.body });
    });
  });
  return (name: string) => cy.then(() => cy.writeFile(`${Cypress.env('OSV_OUT')}/labels/${name}-fails.json`, fails));
};

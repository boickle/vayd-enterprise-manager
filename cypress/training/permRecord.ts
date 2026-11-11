/// <reference types="cypress" />
/**
 * Shared setup for the permissions training videos (docs/training/scripts/permissions/).
 * TEST stack only. Logins are perm-seed.ts's demo staff (CYPRESS_PERM_WORLD), one per role.
 */
import { permWorld, signInAsPerm, PermKey } from './probes-perm/permKit';
import { hideNonProdBanner } from './srRecord';
import { choose, pointAt, tap } from './trainingKit';

export { permWorld };

/** Signs in as one demo staff member and waits for the page, before startClock(). */
export function startAs(who: PermKey, path = '/schedule', ready?: () => void) {
  hideNonProdBanner();
  Cypress.config('scrollBehavior', 'center');
  signInAsPerm(who, path);
  if (ready) ready();
  else cy.get('nav, header', { timeout: 60000 }).should('exist');
  cy.wait(2500, { log: false });
}

/** A top-bar link or tab by its exact text. */
export const topBar = (label: string) =>
  cy.get('a, button, summary').filter((_, el) => (el as HTMLElement).innerText.trim() === label && !!(el as HTMLElement).offsetParent).first();

/** Settings' dropdown tabs (Practice ▾, Staff ▾ …). */
export const settingsMenu = (label: string) =>
  cy.get('button.settings-tab-menu__trigger').filter((_, el) => (el as HTMLElement).innerText.trim() === label).first();
export const settingsItem = (label: string) =>
  cy.get('[role="menuitem"]').filter((_, el) => (el as HTMLElement).innerText.trim() === label).first();

/** Settings → Staff's "Select staff…" picker. */
export const staffPicker = () =>
  cy.get('select').filter((_, el) => Array.from((el as HTMLSelectElement).options).some((o) => /Select staff/i.test(o.text))).first();

/** Picks a person in the staff picker with the cursor, outline and click sound. */
export function pickStaff(name: string) {
  staffPicker().then(($s) => {
    const opt = Array.from(($s[0] as HTMLSelectElement).options).find((o) => o.text.includes(name));
    if (!opt) throw new Error(`No "${name}" in the staff picker`);
    choose(() => staffPicker(), opt.value);
  });
  cy.wait(1500, { log: false });
}

/** The person's hub tabs (Profile, Schedule, … Access). */
export const hubTab = (label: string) =>
  cy.get('[role="tab"]').filter((_, el) => (el as HTMLElement).innerText.trim() === label).first();

/** A settings card by its title. */
export const card = (title: string | RegExp) => cy.contains('.settings-card-title', title).closest('.settings-card');

/**
 * The browser's own hover tooltip (a title attribute) never shows in a recording, so this draws the same text
 * in a tooltip-style box under the element, for `ms`, while the cursor rests on it.
 */
export function showTitle(get: () => Cypress.Chainable<JQuery<HTMLElement>>, ms = 3500) {
  settle(get);
  pointAt(get, ms);
  get().then(($el) => {
    const el = $el[0];
    const text = el.getAttribute('title') || '';
    const doc = el.ownerDocument;
    const r = el.getBoundingClientRect();
    const tip = doc.createElement('div');
    tip.id = 'training-tooltip';
    tip.setAttribute('aria-hidden', 'true');
    tip.textContent = text;
    tip.style.cssText = [
      'position:fixed',
      `left:${Math.round(r.left + 24)}px`,
      `top:${Math.round(r.bottom + 6)}px`,
      'max-width:520px',
      'padding:6px 10px',
      'background:#fffbe6',
      'border:1px solid #c9c2a5',
      'border-radius:4px',
      'box-shadow:0 2px 6px rgba(0,0,0,.18)',
      'font:13px/1.35 system-ui,-apple-system,sans-serif',
      'color:#222',
      'z-index:2147483645',
      'pointer-events:none',
    ].join(';');
    doc.body.appendChild(tip);
  });
  cy.wait(ms, { log: false });
  cy.document({ log: false }).then((doc) => doc.getElementById('training-tooltip')?.remove());
}

/**
 * Jumps the element to the middle of the screen first, so pointAt/tap measure it after the page has stopped
 * moving (a long smooth scroll otherwise leaves the outline 50-100 px off).
 */
export function settle(get: () => Cypress.Chainable<JQuery<HTMLElement>>) {
  get().then(($el) => $el[0].scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior }));
  cy.wait(350, { log: false });
}
export function pointAtSteady(get: () => Cypress.Chainable<JQuery<HTMLElement>>, ms = 2500) {
  settle(get);
  pointAt(get, ms);
}
export function tapSteady(get: () => Cypress.Chainable<JQuery<HTMLElement>>) {
  settle(get);
  tap(get);
}

/** Opens Settings → <menu> → <item> with clicks (one per call, so each can sit under its own line). */
export const openMenu = (menu: string) => tap(() => settingsMenu(menu));
export const openItem = (item: string) => tap(() => settingsItem(item));

/** Runs SQL on the TEST database (CYPRESS_SCH_DB, which must be a vayd_api_test* database), for take setup. */
export function permSql(statement: string) {
  const db = String(Cypress.env('SCH_DB'));
  expect(db, 'CYPRESS_SCH_DB must be a vayd_api_test* database').to.match(/^vayd_api_test[A-Za-z0-9_]*$/);
  return cy.exec(`psql -d ${db} -Atc "${statement.replace(/"/g, '\\"')}"`, { log: false });
}

/** Runs a SQL file from cypress/training/stack on the TEST database (take setup). */
export function permSqlFile(file: string) {
  const db = String(Cypress.env('SCH_DB'));
  expect(db, 'CYPRESS_SCH_DB must be a vayd_api_test* database').to.match(/^vayd_api_test[A-Za-z0-9_]*$/);
  return cy.exec(`psql -v ON_ERROR_STOP=1 -d ${db} -f cypress/training/stack/${file}`, { log: false });
}

/** ROLE-07: one draft email campaign (never sent), made through the API as the practice admin. */
export function draftCampaign() {
  permSql(`DELETE FROM email_campaigns WHERE name = 'Dental Health Month'`);
  return apiAs('practice_admin', 'POST', '/email-campaigns?practiceId=1', {
    name: 'Dental Health Month',
    subject: 'February is Dental Health Month: 10% off dental cleanings',
    html: '<p>Book your pet\'s dental cleaning in February and save 10%.</p>',
  });
}

/** Gives a demo staff member a role (at one office, or practice-wide), straight in the test database. */
export function giveRole(employeeId: number, slug: string, office?: 'raleigh' | 'durham') {
  const branch = office ? permWorld().offices[office] : null;
  return permSql(
    `INSERT INTO employee_role_assignments ("employeeId","roleId","branchId")
     SELECT ${employeeId}, id, ${branch ?? 'NULL'} FROM employee_role WHERE slug='${slug}' AND "pimsType"='SCOUT' AND "isDeleted"=false LIMIT 1`
  );
}

/** Picks the option whose text includes `text` in a select, with the cursor, outline and click sound. */
export function chooseByText(get: () => Cypress.Chainable<JQuery<HTMLElement>>, text: string) {
  get().then(($s) => {
    const opt = Array.from(($s[0] as HTMLSelectElement).options).find((o) => o.text.includes(text));
    if (!opt) throw new Error(`No option "${text}"`);
    choose(get, opt.value);
  });
}

/** Calls the TEST API as one demo staff member (take setup), the same calls the screens make. */
export function apiAs(who: PermKey, method: 'GET' | 'PUT' | 'POST', url: string, body?: unknown) {
  const w = permWorld();
  return cy.request({
    method,
    url: `${Cypress.env('API_URL')}${url}`,
    headers: { Authorization: `Bearer ${w.staff[who].token}` },
    body,
    log: false,
  });
}

/** The changes PERM-02, PERM-03 and PERM-06 make on camera, made through the API (for PERM-05's log). */
export function makeEarlierChanges() {
  const w = permWorld() as unknown as { roleIds: Record<string, number>; offices: { raleigh: number } };
  const sam = permWorld().staff.new_tech.employeeId;
  const lou = permWorld().staff.client_liaison.employeeId;
  const tech = w.roleIds.technician;
  apiAs('practice_admin', 'GET', `/employees/roles/${tech}/assignments?practiceId=1`).then((res) => {
    const now = (res.body.assignments as Array<{ employeeId: number; branchId: number | null }>).map((a) => ({
      employeeId: a.employeeId,
      branchId: a.branchId,
    }));
    apiAs('practice_admin', 'PUT', `/employees/roles/${tech}/assignments?practiceId=1`, {
      assignments: [...now, { employeeId: sam, branchId: w.offices.raleigh }],
    });
  });
  apiAs('practice_admin', 'PUT', `/practice/1/employees/${sam}/permissions/license`, { isLicensed: true, licenseType: 'technician' });
  const ends = new Date(Date.now() + 14 * 86400000).toLocaleDateString('en-CA');
  apiAs('practice_admin', 'POST', `/practice/1/employees/${lou}/permissions/grants`, {
    permissionKey: 'membership.cancel',
    reason: 'Covering while manager is away',
    expiresAt: ends,
  });
}

/** The top bar's menu links (Home … Settings), for pointing at as a group. */
export const topLinks = () => topBar('Home').parent().closest(':has(> * + *)');
/** The left panel's Analytics link. */
export const analyticsLink = () =>
  cy.get('a').filter((_, el) => (el as HTMLElement).innerText.trim() === 'Analytics' && !!(el as HTMLElement).offsetParent).first();
/** Analytics' report category row and the report row under it. */
export const reportCategories = () => cy.get('[aria-label="Report categories"]');
export const reportRow = () =>
  cy.get('body').then(($b) =>
    $b.find('[aria-label$=" reports"]:visible').length
      ? cy.get('[aria-label$=" reports"]').filter(':visible').first()
      : reportCategories()
  );
/** The "Payments" block on a bill's receipt (its heading is upper-case only by style). */
export const billPayments = () => cy.contains('div, span, h3, h4, strong', /^payments$/i).parent();

/** The scheduling world the stack seeded (households A = Riveras, B = Chens). */
export function schWorld(): { households: { A: { clientId: number; activePetIds: number[] }; B: { clientId: number; petId: number } } } {
  const raw = Cypress.env('SCHEDULING_WORLD');
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

/**
 * A paid bill on the Chens: one Office exam for Biscuit, credited to Dr. Maya Ortiz, paid in cash at the counter by
 * Lou Bennett (CL). Made through the API as the screens would. Yields the invoice id.
 */
export function paidChenBill(): Cypress.Chainable<string> {
  const b = schWorld().households.B;
  const ortiz = permWorld().staff.veterinarian.employeeId;
  // One bill per take: clear the Chens' earlier bills (test database only).
  const ids = `(SELECT id FROM visit_invoices WHERE "clientId"=${b.clientId})`;
  permSql(`DELETE FROM visit_invoice_appointments WHERE "invoiceId" IN ${ids}`);
  permSql(`DELETE FROM visit_invoice_tenders WHERE "invoiceId" IN ${ids}`);
  permSql(`DELETE FROM visit_invoice_lines WHERE "invoiceId" IN ${ids}`);
  permSql(`DELETE FROM visit_invoices WHERE "clientId"=${b.clientId}`);
  return apiAs('client_liaison', 'POST', '/visit-invoices/counter', { practiceId: 1, patientId: b.petId, clientId: b.clientId }).then((res) => {
    const id = String(res.body.id);
    return permSql(`SELECT id || ' ' || price FROM procedures WHERE name='Office exam' AND "isDeleted"=false ORDER BY id LIMIT 1`)
      .then((r) => {
        const [pid, price] = String(r.stdout).trim().split(' ');
        return apiAs('client_liaison', 'POST', `/visit-invoices/${id}/lines`, {
          practiceId: 1, patientId: b.petId, description: 'Office exam', qty: 1, unitPrice: Number(price),
          catalogItemId: Number(pid), catalogItemType: 'procedure', providerEmployeeId: ortiz,
        });
      })
      .then(() => permSql(`SELECT total FROM visit_invoices WHERE id='${id}'`))
      .then((r) => {
        const total = Number(String(r.stdout).trim());
        return apiAs('client_liaison', 'POST', `/visit-invoices/${id}/tenders`, { practiceId: 1, method: 'cash', amount: total, cashReceived: total });
      })
      .then(() => id);
  });
}

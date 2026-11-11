/// <reference types="cypress" />
/** Permissions probes and videos: sign in as one of perm-seed.ts's demo staff. Test stack only. */
export type PermKey =
  | 'practice_admin' | 'practice_manager' | 'medical_director' | 'veterinarian' | 'departing_vet'
  | 'relief_veterinarian' | 'lead_technician' | 'technician' | 'new_tech' | 'lead_client_liaison'
  | 'client_liaison' | 'inventory_manager' | 'billing_ar' | 'controlled_substances_director'
  | 'mail_order_manager' | 'mail_order_team' | 'observer' | 'executive';

type PermWorld = {
  offices: { raleigh: number; durham: number };
  staff: Record<PermKey, { employeeId: number; userId: number; name: string; token: string }>;
};

export function permWorld(): PermWorld {
  const raw = Cypress.env('PERM_WORLD');
  if (!raw) throw new Error('Set CYPRESS_PERM_WORLD to the JSON written by stack/perm-seed.ts');
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

/**
 * Serves the Inter font from local copies (CYPRESS_PERM_FONT_DIR: inter.css plus its .woff2 files), so a slow
 * Google Fonts request through the Cypress proxy can't hold up the first page load. Same font, same look.
 */
function localFonts() {
  const dir = Cypress.env('PERM_FONT_DIR');
  if (!dir) return;
  cy.readFile(`${dir}/inter.css`, { log: false }).then((css: string) => {
    cy.intercept({ method: 'GET', hostname: 'fonts.googleapis.com' }, { statusCode: 200, headers: { 'content-type': 'text/css' }, body: css });
    const files = Array.from(new Set(css.match(/__permfonts\/[^)]+/g) ?? [])).map((m) => m.split('/')[1]);
    for (const f of files) {
      cy.readFile(`${dir}/${f}`, null, { log: false }).then((buf) => {
        cy.intercept({ method: 'GET', pathname: `/__permfonts/${f}` }, { statusCode: 200, headers: { 'content-type': 'font/woff2' }, body: buf });
      });
    }
  });
  cy.intercept({ method: 'GET', hostname: 'fonts.gstatic.com' }, { statusCode: 204 });
}

export function signInAsPerm(who: PermKey, path = '/schedule') {
  const w = permWorld();
  localFonts();
  cy.visit('/login');
  cy.window().then((win) => {
    win.localStorage.clear();
    win.localStorage.setItem('accessToken', w.staff[who].token);
  });
  cy.visit(path);
}

/** Writes the page's visible text (and every link) to the probe output folder. */
export function dumpPage(name: string) {
  cy.document().then((doc) => {
    const links = Array.from(doc.querySelectorAll('a[href]')).map((a) => `${(a as HTMLElement).innerText.trim().replace(/\s+/g, ' ')} -> ${a.getAttribute('href')}`);
    const text = (doc.body as HTMLElement).innerText;
    cy.writeFile(`${Cypress.env('PROBE_OUT')}/${name}.txt`, `URL ${doc.location.pathname}${doc.location.search}\n\n${text}\n\n== LINKS\n${links.join('\n')}\n`);
  });
}

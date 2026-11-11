/// <reference types="cypress" />
import '../support/e2e';

/**
 * RP-08-5 (written, not run): screen to database for the Executive role and the Marketing menu.
 * Seed with vayd-api test/scripts/rp-08-e2e-seed.ts (a vayd_api_test* database with the executive-role
 * migration):
 *   npx ts-node -T test/scripts/rp-08-e2e-seed.ts seed vayd_api_test_x /tmp/rp08-world.json
 *   CYPRESS_RP08_WORLD="$(cat /tmp/rp08-world.json)" npx cypress run --spec cypress/e2e/rp-08-executive-marketing.cy.ts
 *   npx ts-node -T test/scripts/rp-08-e2e-seed.ts clean vayd_api_test_x /tmp/rp08-world.json
 *
 * The executive opens VSD (sees the seeded doctor's production) and Email campaigns (sees the seeded draft)
 * with no create, edit, send or save buttons, and no Settings or Admin in the top nav. The practice manager
 * opens Marketing ▸ Promotions, then the Appointment Request Promotions tab, edits the seeded promotion, and the change
 * is read back from the API. Nothing is emailed: the seed's households block contact and no send is clicked.
 */
type Rp08World = {
  today: string;
  doctorName: string;
  doctorTotal: number;
  campaignId: string;
  campaignName: string;
  promotionId: number;
  promotionCompany: string;
  executiveToken: string;
  managerToken: string;
};
const world = (): Rp08World => {
  const raw = Cypress.env('RP08_WORLD') as string | Rp08World | undefined;
  if (!raw) throw new Error('Set CYPRESS_RP08_WORLD to the JSON from rp-08-e2e-seed.ts');
  return typeof raw === 'string' ? (JSON.parse(raw) as Rp08World) : raw;
};
const apiBase = () =>
  Cypress.env('API_URL') ||
  Cypress.config('baseUrl')?.replace(':5173', ':3000') ||
  'http://localhost:3000';
const usd = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);

const signIn = (token: string) => {
  cy.visit('/login');
  cy.window().then((win) => {
    win.localStorage.clear();
    win.localStorage.setItem('accessToken', token);
  });
};

const noWriteButtons = () => {
  for (const name of [
    /^save/i,
    /new campaign/i,
    /send test/i,
    /^schedule$/i,
    /send now/i,
    /duplicate/i,
  ]) {
    cy.contains('button', name).should('not.exist');
  }
};

describe('RP-08-5: Executive and Practice Manager in Marketing', () => {
  // Wide enough that the top nav doesn't fold Marketing into "More" (as other specs do).
  beforeEach(() => cy.viewport(1920, 1080));

  it('the executive sees VSD and Email campaigns with data and no save buttons', () => {
    const w = world();
    signIn(w.executiveToken);

    // /schedule/analytics opens on Payments; VSD is the "Veterinary Services Delivered" chip.
    cy.visit('/schedule/analytics');
    cy.contains('Veterinary Services Delivered', { timeout: 30000 }).click();
    // The name also appears in the chart legend (a hidden button), so target the doctor's list row.
    cy.contains('li', w.doctorName, { timeout: 30000 })
      .scrollIntoView()
      .should('be.visible')
      .and('contain.text', usd(w.doctorTotal));
    cy.contains('doctor-level detail is limited').should('not.exist');
    noWriteButtons();

    // Top nav: Marketing, no Settings, no Admin.
    cy.get('nav[aria-label="Schedule sections"]').within(() => {
      cy.contains('summary', 'Marketing').should('exist');
      cy.contains('a', /^Settings$/).should('not.exist');
      cy.contains('a', /^Admin$/).should('not.exist');
    });

    cy.contains('summary', 'Marketing').click();
    cy.contains('[role="menuitem"]', 'Email campaigns').click();
    cy.location('pathname').should('eq', '/schedule/marketing');
    cy.contains('h5', 'Email campaigns', { timeout: 30000 }).should('be.visible');
    cy.contains(w.campaignName).should('be.visible');
    noWriteButtons();

    // The draft opens view only: the name can't be changed and the review step has no send controls.
    cy.contains(w.campaignName).click();
    cy.get('input[aria-label="Campaign name"]', { timeout: 30000 }).should('be.disabled');
    cy.contains('[role="tab"]', 'Review').click();
    cy.contains('View only.').should('be.visible');
    noWriteButtons();
  });

  it('the practice manager edits an appointment request promotion from the Marketing menu, and it is saved', () => {
    const w = world();
    const newName = `RP08 edited ${Date.now()}`;
    signIn(w.managerToken);
    cy.visit('/schedule/home');

    cy.get('nav[aria-label="Schedule sections"]').within(() => {
      cy.contains('a', /^Admin$/).should('not.exist');
    });
    cy.contains('summary', 'Marketing', { timeout: 30000 }).click();
    cy.contains('[role="menuitem"]', /^Promotions$/).click();
    cy.contains('nav[aria-label="Promotions"] a', 'Appointment Request Promotions').click();
    cy.location('pathname').should('eq', '/schedule/marketing/appointment-request-promotions');

    cy.intercept('PATCH', `**/appointment-request-promotions/${w.promotionId}`).as('save');
    cy.contains('tr', w.promotionCompany, { timeout: 30000 })
      .find('button[aria-label="Edit"], [aria-label="Edit"] button')
      .first()
      .click();
    cy.contains('Edit appointment request promotion').should('be.visible');
    cy.get('input')
      .filter((_, el) =>
        (el.closest('.MuiFormControl-root')?.textContent ?? '').includes('Public Name')
      )
      .first()
      .clear()
      .type(newName);
    cy.contains('button', /^save/i).click();
    cy.wait('@save').its('response.statusCode').should('eq', 200);

    cy.request({
      method: 'GET',
      url: `${apiBase()}/appointment-request-promotions/${w.promotionId}`,
      headers: { Authorization: `Bearer ${w.managerToken}` },
    })
      .its('body.name')
      .should('eq', newName);
  });
});

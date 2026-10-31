/// <reference types="cypress" />

/**
 * Room Loader go-live plan (vayd-api docs/test-plans/room-loader.md), batch A, end-to-end:
 * RL-01-8 (store items once per household), RL-02-11 (server price with a break),
 * RL-13-5 (store line taxed and drawn from stock).
 *
 * Each case seeds a sent room loader with the cypress task `seedRoomLoader` (cypress.config.ts,
 * "H-RL"), submits the check-in form the way the browser does (POST /public/room-loader/submit with
 * the form's `summaryForPdf`; the server reprices it, D5), then signs in as staff and works the
 * visit checkout's "Pre-visit accepts" panel. The scenario object asks the task for:
 *   { pets: n, reminders: [{ code, quantity, price, breaks }], storeItems: [{ name, price, taxable, onHand }] }
 * and these cases read back { patients: [{ id, name, appointmentId }], items: { <code>: id },
 * storeItems: [{ name, inventoryItemId }] } in addition to { loaderId, token, petName, path }.
 * Stripe and email are the API's fakes; nothing real is sent or charged. Needs the API on
 * vayd_api_test, the dev server pointed at it, and EMPLOYEE_EMAIL / EMPLOYEE_PASSWORD.
 *
 * Status: run against the test stack; the seed task also returns `staff` ({ email, password }) for the checkout login.
 */
type SeededPet = { id: number; name: string; appointmentId: number };
type Seeded = {
  loaderId: number;
  token: string;
  petName: string;
  path: string;
  patients: SeededPet[];
  items: Record<string, number>;
  storeItems: Array<{ name: string; inventoryItemId: number }>;
  staff: { email: string; password: string };
};

const apiUrl = () =>
  Cypress.env('API_URL') || Cypress.config('baseUrl')?.replace(':5173', ':3000') || 'http://localhost:3000';

const seed = (scenario: Record<string, unknown>) => cy.task<Seeded>('seedRoomLoader', { scenario });

/** The browser's submit: `summaryForPdf` as the form builds it (prices are the browser's guesses). */
const submitForm = (s: Seeded, summaryForPdf: Record<string, unknown>) =>
  cy.request('POST', `${apiUrl()}/public/room-loader/submit`, {
    token: s.token,
    formData: { summaryForPdf, submittedAt: new Date().toISOString() },
  });

const checkout = (pet: SeededPet) => `/schedule/soap/${pet.appointmentId}/${pet.id}/checkout`;
/** Opens the visit as staff the way the app does: creating the encounter runs the pre-visit preload. */
const startVisit = (s: Seeded, pet: SeededPet) => {
  cy.request('POST', `${apiUrl()}/auth/login`, s.staff).then((login) => {
    cy.request({
      method: 'POST',
      url: `${apiUrl()}/soap-encounters`,
      headers: { Authorization: `Bearer ${login.body.accessToken}` },
      body: { practiceId: 1, appointmentId: pet.appointmentId, patientId: pet.id, mode: 'comprehensive' },
    }).its('status').should('be.oneOf', [200, 201]);
  });
};

const previsit = () => cy.get('.soap-invoice-previsit', { timeout: 30000 });

/** Accepts every pending pre-visit line on the open checkout. */
const acceptAll = (opts: { mayBeEmpty?: boolean } = {}) => {
  // The panel is absent when nothing is pending (e.g. the second pet in RL-01-8); give the page time to load first.
  if (opts.mayBeEmpty) cy.wait(6000);
  cy.get('body', { timeout: 30000 }).then(($body) => {
    if (opts.mayBeEmpty && !$body.find('.soap-invoice-previsit').length) return;
    previsit().then(($p) => {
      const n = $p.find('button:contains("Accept")').length;
      for (let i = 0; i < n; i++) {
        previsit().contains('button', 'Accept').first().click();
        cy.wait(500);
      }
    });
  });
};

after(() => {
  cy.task('cleanRoomLoader');
});

describe('RL-01-8: store items charged once per household (end to end)', () => {
  it('a 2-pet form with one store item: listed once in Pre-visit accepts, on the invoice once', () => {
    seed({ pets: 2, storeItems: [{ name: 'Calming chews', price: 45, taxable: true }] }).then((s) => {
      const [a, b] = s.patients;
      submitForm(s, {
        pets: s.patients.map((p) => ({ patientId: p.id, patientName: p.name, rows: [], subtotal: 0 })),
        additionalItems: {
          items: [
            {
              name: 'Calming chews',
              quantity: 1,
              price: 45,
              lineTotal: 45,
              code: 'SKU-CALM',
              inventoryItemId: s.storeItems[0].inventoryItemId,
              catalogItemType: 'inventory',
            },
          ],
          subtotal: 45,
          tax: 2.48,
        },
        grandTotal: 47.48,
      }).its('status').should('be.oneOf', [200, 201]);

      startVisit(s, a);
      cy.apiLogin('employee', { ...s.staff, startPath: checkout(a) });
      previsit().find('.soap-invoice-previsit-row').filter(':contains("Calming chews")').should('have.length', 1);
      acceptAll();

      startVisit(s, b);
      cy.visit(checkout(b));
      cy.get('body', { timeout: 30000 }).then(($body) => {
        const rows = $body.find('.soap-invoice-previsit-row:contains("Calming chews")');
        expect(rows.length, 'store item not proposed again on the second pet').to.eq(0);
      });
      acceptAll({ mayBeEmpty: true });

      // The household invoice carries the store item once.
      cy.contains('Calming chews', { timeout: 30000 });
      cy.get('body').then(($body) => {
        const text = $body.text();
        const hits = text.split('Calming chews').length - 1;
        expect(hits, 'Calming chews on the invoice').to.be.at.most(2); // line + order name at most
      });
    });
  });
});

describe('RL-02-11: server reprices the check-in line (end to end)', () => {
  it('Interceptor x6 sent by staff: shows and charges 6 x $13.19 = $79.14', () => {
    seed({
      pets: 1,
      reminders: [
        {
          code: 'INTERYELLOW',
          quantity: 6,
          price: 14.26,
          breaks: [
            { low: 6, high: 11, price: 13.19 },
            { low: 12, high: 100, price: 12.48 },
          ],
        },
      ],
    }).then((s) => {
      const [dog] = s.patients;
      submitForm(s, {
        pets: [
          {
            patientId: dog.id,
            patientName: dog.name,
            // The browser's old math: unit price at qty 1 times 6.
            rows: [{ name: 'Interceptor Plus Yellow', code: 'INTERYELLOW', quantity: 6, price: 14.26, lineTotal: 85.56, checked: true }],
            subtotal: 85.56,
          },
        ],
        grandTotal: 85.56,
      }).its('status').should('be.oneOf', [200, 201]);

      startVisit(s, dog);
      cy.apiLogin('employee', { ...s.staff, startPath: checkout(dog) });
      previsit()
        .contains('.soap-invoice-previsit-row', 'Interceptor')
        .within(() => {
          cy.contains('×6');
          cy.contains('$79.14');
        });
      acceptAll();
      cy.contains('$79.14', { timeout: 30000 }).should('be.visible');
      cy.contains('$85.56').should('not.exist');
    });
  });
});

describe('RL-13-5: store line carries its catalog item (end to end)', () => {
  it('a taxable store item: the invoice shows tax on the line, Activity shows the stock draw', () => {
    seed({ pets: 1, storeItems: [{ name: 'Oatmeal shampoo', price: 40, taxable: true, onHand: 5 }] }).then((s) => {
      const [dog] = s.patients;
      submitForm(s, {
        pets: [{ patientId: dog.id, patientName: dog.name, rows: [], subtotal: 0 }],
        additionalItems: {
          items: [
            {
              name: 'Oatmeal shampoo',
              quantity: 1,
              price: 40,
              lineTotal: 40,
              code: 'SKU-OAT-12',
              inventoryItemId: s.storeItems[0].inventoryItemId,
              catalogItemType: 'inventory',
            },
          ],
          subtotal: 40,
          tax: 2.2,
        },
        grandTotal: 42.2,
      }).its('status').should('be.oneOf', [200, 201]);

      startVisit(s, dog);
      cy.apiLogin('employee', { ...s.staff, startPath: checkout(dog) });
      acceptAll();
      // 5.5% of $40.
      cy.contains('$2.20', { timeout: 30000 }).should('be.visible');
      // Payment is what closes the invoice (there is no Finalize step): pay it in cash.
      // Checkout needs a provider on the line and a follow-up answer first.
      cy.contains('label', /Not appropriate/i).click();
      cy.get('.soap-invoice-line select, select').contains('option', /Dana|Doc|Provider/i);
      cy.contains('button', /Cash/).click();
      cy.contains('button', /^(OK|Confirm|Submit|Save)$/).click();
      cy.contains(/paid/i, { timeout: 30000 });
      cy.visit('/schedule/analytics/inventory/activity');
      cy.contains(/Oatmeal shampoo/i, { timeout: 30000 });
      cy.contains(/sold|visit use|drawn/i).should('be.visible');
    });
  });
});

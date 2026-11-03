/// <reference types="cypress" />
import '../support/e2e';
import { cleanEmrWorld, emrApi, seedEmrWorld, type EmrWorld } from '../support/emrWorld';

/**
 * EMR-03-5: a family fills the public euthanasia consent form, the first card is declined at the hold, they retry
 * with a good card. The staff estimate shows each item once and the consent reads signed.
 *
 * Needs (see cypress/support/emrWorld.ts):
 *   EMR_DB=<test db> CYPRESS_EMR_DB=<same test db> npx cypress run --spec cypress/e2e/emr-03-consent-retry.cy.ts
 * The dev API must use the same test database and a Stripe TEST key (sk_test / pk_test), and chromeWebSecurity:
 * false (cypress.config.ts) so the spec can type into the Stripe card iframe. The cards are Stripe test cards:
 * 4000 0000 0000 0341 attaches to a customer but every charge or hold on it is declined; 4242 succeeds.
 *
 * The H-EMR world is adjusted for this spec, all on the test database and undone in after():
 *   - the estimate's unmarked "Private cremation" line is removed (the form refuses to guess an unmarked plan),
 *     leaving the 350.00 euthanasia line, so the plan reads back as home burial; the made-up saved card
 *     (cus_emr_world, which does not exist at Stripe) is cleared so the form saves the card the family enters
 *   - the client gets an address, so the form asks the family to confirm it instead of typing one
 *   - a priced clay paw print (40.00, tagged EMRTEST) is linked in practice settings and offered by the seeded vet
 */
const CLAY_PRICE = 40;
const SETTING_KEYS = ['euthanasia.pawPrintItems', 'euthanasia.providerPawPrintOfferings'];

const testDb = () => {
  const name = String(Cypress.env('EMR_DB') || '');
  if (!name || !/test/i.test(name) || /vayd_api_local|prod/i.test(name)) {
    throw new Error(`Set CYPRESS_EMR_DB to the dedicated test database (got "${name}")`);
  }
  return name;
};

/** One SQL statement on the test database; returns the first line of output. */
const sql = (statement: string): Cypress.Chainable<string> =>
  cy
    .exec(`psql -h localhost -U vayd -d ${testDb()} -tA -c "$EMR_SQL"`, {
      env: { PGPASSWORD: 'vayd', EMR_SQL: statement },
    })
    .then((r) => r.stdout.trim().split('\n')[0] ?? '');

const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;

/** Types into one field of the Stripe card iframe. */
const stripeField = (name: string, value: string) =>
  cy
    .get('.consent-card-box iframe', { timeout: 30000 })
    .its('0.contentDocument.body')
    .should('not.be.empty')
    .then(cy.wrap)
    .find(`input[name="${name}"]`, { timeout: 30000 })
    .clear()
    .type(value);

const enterCard = (number: string) => {
  stripeField('cardnumber', number);
  stripeField('exp-date', '1234');
  stripeField('cvc', '123');
  cy.get('.consent-card-box iframe')
    .its('0.contentDocument.body')
    .then(($body) => {
      if (Cypress.$($body).find('input[name="postal"]').length) stripeField('postal', '04101');
    });
  cy.wait(1500); // let Stripe report the card complete to the form
};

const sign = () => {
  cy.get('.consent-signature canvas')
    .trigger('pointerdown', 20, 30, { pointerId: 1, force: true })
    .trigger('pointermove', 80, 40, { pointerId: 1, force: true })
    .trigger('pointermove', 160, 25, { pointerId: 1, force: true })
    .trigger('pointerup', 160, 25, { pointerId: 1, force: true });
};

describe('EMR-03-5: consent retry after a declined card', () => {
  let world: EmrWorld;
  let clayId = '';
  let savedSettings = '[]';

  before(() => {
    seedEmrWorld().then((w) => {
      world = w;
      const e = w.euthanasia;
      sql(`DELETE FROM visit_estimate_lines WHERE "estimateId"=${quote(e.estimateId)} AND description ILIKE '%cremation%'`);
      sql(
        `UPDATE visit_estimates SET subtotal=350, total=350, "stripeCustomerId"=NULL, "savedPaymentMethodId"=NULL WHERE id=${quote(e.estimateId)}`,
      );
      sql(`UPDATE clients SET address1='12 Willow Lane', city='Portland', state='ME', zipcode='04101' WHERE id=${w.client.id}`);
      sql(
        `INSERT INTO procedures (name, code, price, "taxLevelValue", "practiceId", "pimsId", "pimsType", "isActive", "isDeleted")
         VALUES ('Final Gift Clay Paw Print', ${quote(`${w.tag}-clay`)}, ${CLAY_PRICE}, 0, ${w.practiceId}, ${quote(`${w.tag}-clay`)}, 'EMRTEST', true, false)
         RETURNING id`,
      ).then((id) => {
        clayId = id;
        sql(
          `SELECT coalesce(json_agg(json_build_object('key', key, 'value', value)), '[]') FROM practice_settings
            WHERE "practiceId"=${w.practiceId} AND key IN (${SETTING_KEYS.map(quote).join(',')})`,
        ).then((old) => {
          savedSettings = old || '[]';
          const values: Record<string, string> = {
            'euthanasia.pawPrintItems': JSON.stringify({
              clayCharge: { itemType: 'procedure', itemId: Number(clayId), name: 'Final Gift Clay Paw Print' },
            }),
            'euthanasia.providerPawPrintOfferings': JSON.stringify({
              [String(w.staff.employeeId)]: { ink: true, clayCharge: true, clayFree: false },
            }),
          };
          for (const key of SETTING_KEYS) {
            sql(
              `INSERT INTO practice_settings ("practiceId", key, value) VALUES (${w.practiceId}, ${quote(key)}, ${quote(values[key])})
               ON CONFLICT ("practiceId", key) DO UPDATE SET value = EXCLUDED.value`,
            );
          }
        });
      });
    });
  });

  after(() => {
    if (world) {
      sql(`DELETE FROM practice_settings WHERE "practiceId"=${world.practiceId} AND key IN (${SETTING_KEYS.map(quote).join(',')})`);
      const old = JSON.parse(savedSettings) as Array<{ key: string; value: string }>;
      for (const row of old) {
        sql(`INSERT INTO practice_settings ("practiceId", key, value) VALUES (${world.practiceId}, ${quote(row.key)}, ${quote(row.value)})`);
      }
      if (clayId) sql(`DELETE FROM procedures WHERE id=${Number(clayId)}`);
    }
    cleanEmrWorld();
  });

  it('fill the form, a declined card, then a good card: each item once on the estimate; consent signed', () => {
    cy.intercept('POST', '**/consent/euthanasia/submit').as('submit');
    cy.visit(world.euthanasia.consentPath);

    // Page 1: the family, the addresses on file, the weight, who to notify.
    cy.contains('label', 'Yes — that is the address we should come to', { timeout: 30000 }).click();
    cy.contains('label', 'Yes — that mailing address is correct').click();
    cy.contains('label', 'Weight (lbs)').find('input').clear().type('42');
    cy.contains('label', 'None — there is no one to notify').find('input').check();
    cy.contains('button', /^Next$/).click();

    // Page 2: the plan on the quote (home burial) read back and confirmed.
    cy.contains('label', `Is this what you would like for`).find('select').select('yes');
    cy.contains('button', /^Next$/).click();

    // Page 3: the charged clay paw print.
    cy.contains('label.consent-option', /clay/i).find('input[type="checkbox"]').check();
    cy.contains(`$${CLAY_PRICE.toFixed(2)}`);
    cy.contains('button', /^Next$/).click();

    // Page 4: consent, signature, and a card the hold will decline.
    cy.contains('label', 'I have read and agree to the consent above.').find('input').check();
    sign();
    enterCard('4000000000000341');
    cy.contains('button', /and submit$/).click();
    cy.wait('@submit', { timeout: 60000 }).its('response.statusCode').should('eq', 400);
    cy.contains(/another card/i, { timeout: 20000 });

    // Nothing the family picked stayed on the quote after the decline.
    emrApi(world, 'GET', `/visit-estimates/${world.euthanasia.estimateId}?practiceId=${world.practiceId}`).then((res) => {
      const lines = (res.body?.lines ?? []) as Array<{ description: string }>;
      expect(lines.filter((l) => /clay/i.test(l.description))).to.have.length(0);
    });

    // Retry with a good card.
    enterCard('4242424242424242');
    cy.contains('button', /and submit$/).click();
    cy.wait('@submit', { timeout: 60000 }).its('response.statusCode').should('eq', 201);
    cy.contains('h1', 'Thank you', { timeout: 30000 });

    // Staff view of the estimate: each item once, total and hold include the clay print once.
    emrApi(world, 'GET', `/visit-estimates/${world.euthanasia.estimateId}?practiceId=${world.practiceId}`).then((res) => {
      expect(res.status).to.eq(200);
      const lines = (res.body?.lines ?? []) as Array<{ description: string }>;
      const counts = lines.reduce<Record<string, number>>((acc, l) => ({ ...acc, [l.description]: (acc[l.description] ?? 0) + 1 }), {});
      Object.entries(counts).forEach(([description, n]) => expect(n, description).to.eq(1));
      expect(lines.filter((l) => /clay/i.test(l.description))).to.have.length(1);
      expect(Number(res.body.total)).to.eq(350 + CLAY_PRICE);
      expect(Number(res.body.authorizedAmount)).to.eq(350 + CLAY_PRICE);
    });

    // Consent reads signed for staff.
    emrApi(world, 'GET', `/consent/euthanasia/statuses?appointmentIds=${world.euthanasia.appointmentId}`).then((res) => {
      expect(res.status).to.eq(200);
      expect(res.body.statuses[String(world.euthanasia.appointmentId)]).to.eq('complete');
    });
  });
});

/// <reference types="cypress" />
import '../support/e2e';
import { stubScribeClientRecap } from '../support/scribeStubs';

/**
 * AI-scribe Wave 2 Batch C, end to end: SCR-02-4 (plan: vayd-api docs/test-plans/ai-scribe.md).
 * Dose corrected after the first visit to wrap-up: the banner shows, and Regenerate sends a request that
 * the real API answers from the new sig (the writer itself is stubbed).
 *
 * Seed (a database whose name contains "test"), from vayd-api:
 *   npx ts-node -T test/scripts/scribe-e2e-seed.ts seed vayd_api_test_e2e /tmp/scribe-world.json
 * Run, with the dev server and an API on the same database (CONTROL_DB_ENABLED=false GMAIL_POLL_INTERVAL_MS=0):
 *   CYPRESS_SCRIBE_WORLD="$(cat /tmp/scribe-world.json)" CYPRESS_E2E_DB=vayd_api_test_e2e \
 *     npx cypress run --spec cypress/e2e/scr-wave2c.cy.ts
 * The API must include the SCR-02 change (wrap-up returns emailDraftStale; recap-draft accepts fromCharts).
 * Needs psql on the PATH. The AI answer comes from cypress/support/scribeStubs.ts; nothing reaches an LLM,
 * Stripe or Gmail. Invented names only. Uses the household's first pet (Aster, dog, empty draft).
 * Not run by the author (Cypress is run by the coordinator).
 */
type Pet = { patientId: number; name: string; species: string; appointmentId: number; encounterId: string };
type ScribeWorld = {
  practiceId: number;
  auth: Record<'veterinarian' | 'technician' | 'practice_manager', { Authorization: string; token: string }>;
  households: { household: { clientId: number; pets: Pet[] } };
};

const world = (): ScribeWorld => {
  const raw = Cypress.env('SCRIBE_WORLD') as string | ScribeWorld | undefined;
  if (!raw) throw new Error('Set CYPRESS_SCRIBE_WORLD to the JSON from test/scripts/scribe-e2e-seed.ts');
  return typeof raw === 'string' ? (JSON.parse(raw) as ScribeWorld) : raw;
};
const dbName = () => String(Cypress.env('E2E_DB') || 'vayd_api_test_e2e');
const apiUrl = () => String(Cypress.env('API_URL') || 'http://localhost:3000');

function sql(statement: string): Cypress.Chainable<string> {
  if (!/test/i.test(dbName()) || /vayd_api_local|prod/i.test(dbName())) {
    throw new Error(`Refusing: "${dbName()}" is not a dedicated test database`);
  }
  return cy
    .exec('psql -h localhost -U vayd -d ' + dbName() + ' -tA -c "$SCR_SQL"', {
      env: { PGPASSWORD: 'vayd', SCR_SQL: statement },
    })
    .then((r) => r.stdout.trim());
}

function signIn(path: string) {
  const w = world();
  cy.visit('/login');
  cy.window().then((win) => {
    win.localStorage.clear();
    win.localStorage.setItem('accessToken', w.auth.veterinarian.token);
  });
  cy.visit(path);
}

const wrapUpPath = (pet: Pet, clientId: number) => `/schedule/soap/${pet.appointmentId}/${pet.patientId}/wrap-up?clientId=${clientId}`;

describe('AI scribe Wave 2C (SCR-02)', () => {
  it('SCR-02-4 a sig corrected after the recap was written shows the banner, and Regenerate then rewrites the recap', () => {
    const w = world();
    const { clientId, pets } = w.households.household;
    const [aster] = pets;
    const headers = { Authorization: w.auth.veterinarian.Authorization };
    const call = (method: 'POST' | 'PUT', url: string, body: Record<string, unknown>) =>
      cy.request({ method, url: `${apiUrl()}${url}`, headers, body: { practiceId: w.practiceId, ...body } });

    // Start clean: no saved recap, no earlier prescription; give Aster one amoxicillin order with a sig.
    sql(`UPDATE soap_encounters SET subjective = coalesce(subjective, '{}'::jsonb) - 'clientEmailSubject' - 'clientEmailBody' - 'clientEmailSourceHash' WHERE id = '${aster.encounterId}'`);
    sql(`DELETE FROM prescriptions WHERE "encounterOrderId" IN (SELECT id FROM encounter_orders WHERE "encounterId" = '${aster.encounterId}')`);
    sql(`DELETE FROM encounter_orders WHERE "encounterId" = '${aster.encounterId}'`);
    sql(`SELECT id FROM inventory_items WHERE "practiceId" = ${w.practiceId} AND "isActive" = true ORDER BY id LIMIT 1`).then((itemId) => {
      call('POST', `/soap-encounters/${aster.encounterId}/orders`, {
        name: 'Amoxicillin 50 mg tab', kind: 'med', catalogItemId: Number(itemId), catalogItemType: 'inventory',
        qty: 1, unitPrice: 18, state: 'accepted',
      }).then((order) => {
        const saveSig = (instructions: string) =>
          call('PUT', `/soap-encounters/${aster.encounterId}/orders/${order.body.id}/prescription`, {
            instructions, refill: 1, acuity: 'acute',
            refillExpiration: new Date(Date.now() + 180 * 864e5).toISOString().slice(0, 10),
          });
        saveSig('1 tablet by mouth twice daily for 7 days').its('status').should('be.lessThan', 300);

        // First visit to wrap-up: the stubbed writer drafts the recap and the page saves it. No banner.
        const recap = stubScribeClientRecap();
        signIn(wrapUpPath(aster, clientId));
        cy.contains('Client recap', { timeout: 30000 }).should('exist');
        cy.wrap(null).should(() => expect(recap.count()).to.eq(1));
        cy.get('[data-cy="recap-stale-banner"]').should('not.exist');
        sql(`SELECT subjective->>'clientEmailSourceHash' IS NOT NULL FROM soap_encounters WHERE id = '${aster.encounterId}'`).should('eq', 't');

        // Back at the chart, the doctor corrects the sig; then returns to wrap-up.
        signIn('/schedule');
        saveSig('1 tablet by mouth once daily for 14 days').its('status').should('be.lessThan', 300);
        signIn(wrapUpPath(aster, clientId));
        cy.contains('Charts changed after this recap was written', { timeout: 30000 }).should('be.visible');
        // Not silently rewritten: the writer was not asked again, and the saved draft is untouched.
        cy.wait(1500);
        cy.wrap(null).should(() => expect(recap.count()).to.eq(1));

        // Regenerate: the writer is asked again, the banner goes, and the server sees the draft as fresh.
        cy.get('[data-cy="recap-stale-regenerate"]').click();
        cy.wrap(null).should(() => expect(recap.count()).to.eq(2));
        cy.get('[data-cy="recap-stale-banner"]').should('not.exist');
        // The regenerate request makes the real API read the new sig: the stale flag is gone and the new sig is on file.
        sql(`SELECT instructions FROM prescriptions WHERE "encounterOrderId" = '${order.body.id}' AND "isDeleted" = false`).should('contain', 'once daily for 14 days');
        cy.request({ url: `${apiUrl()}/soap-encounters/${aster.encounterId}/wrap-up`, headers, qs: { practiceId: w.practiceId } })
          .its('body.emailDraftStale').should('eq', false);
      });
    });
  });
});

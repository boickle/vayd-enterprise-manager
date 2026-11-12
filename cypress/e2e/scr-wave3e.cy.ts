/// <reference types="cypress" />
import '../support/e2e';
import { stubScribeClientRecap } from '../support/scribeStubs';

/**
 * AI-scribe Wave 3 Batch E, end to end: SCR-03-4 (plan: vayd-api docs/test-plans/ai-scribe.md, owner decision D1).
 * Wrap-up after a euthanasia: the real API flags the pet who died, the recap request goes out for the
 * household, the condolence subject shows, and the doctor can still send or skip.
 *
 * Seed (a database whose name contains "test"), from vayd-api:
 *   npx ts-node -T test/scripts/scribe-e2e-seed.ts seed vayd_api_test_e2e /tmp/scribe-world.json
 * Run, with the dev server and an API on the same database (CONTROL_DB_ENABLED=false GMAIL_POLL_INTERVAL_MS=0):
 *   CYPRESS_SCRIBE_WORLD="$(cat /tmp/scribe-world.json)" CYPRESS_E2E_DB=vayd_api_test_e2e \
 *     npx cypress run --spec cypress/e2e/scr-wave3e.cy.ts
 * The API must include the SCR-03 change (wrap-up pets carry `deceased`). Needs psql on the PATH.
 * The AI answer comes from cypress/support/scribeStubs.ts (condolence fixture); nothing reaches an LLM,
 * Stripe or Gmail. Invented names only: households.euthanasia is Juniper (euthanized, chart signed,
 * no "euthan..." wording in it) and Poppy (wellness, rabies).
 * Not run by the author (Cypress is run by the coordinator).
 */
type Pet = { patientId: number; name: string; species: string; appointmentId: number; encounterId: string };
type ScribeWorld = {
  practiceId: number;
  auth: Record<'veterinarian' | 'technician' | 'practice_manager', { Authorization: string; token: string }>;
  households: { euthanasia: { clientId: number; pets: Pet[] } };
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

describe('AI scribe Wave 3E (SCR-03)', () => {
  it('SCR-03-4 wrap-up after a euthanasia flags the pet, shows the condolence subject, and the doctor can send or skip', () => {
    const w = world();
    const { clientId, pets } = w.households.euthanasia;
    const juniper = pets.find((p) => p.name === 'Juniper')!;
    const poppy = pets.find((p) => p.name === 'Poppy')!;
    const headers = { Authorization: w.auth.veterinarian.Authorization };
    const ids = `'${juniper.encounterId}','${poppy.encounterId}'`;

    // Start clean: no saved recap and no recorded email decision on either chart.
    sql(
      `UPDATE soap_encounters SET subjective = coalesce(subjective, '{}'::jsonb) - 'clientEmailSubject' - 'clientEmailBody' - 'clientEmailSourceHash', "clientEmailDelivery" = NULL WHERE id IN (${ids})`,
    );

    // The real API flags the pet who died; the chart itself never says "euthanasia".
    cy.request({ url: `${apiUrl()}/soap-encounters/${juniper.encounterId}/wrap-up`, headers, qs: { practiceId: w.practiceId } }).then(
      (res) => {
        const flagged = (res.body.pets as Array<{ patientId: number; deceased?: string | null }>).find(
          (p) => p.patientId === juniper.patientId,
        );
        const other = (res.body.pets as Array<{ patientId: number; deceased?: string | null }>).find(
          (p) => p.patientId === poppy.patientId,
        );
        expect(flagged?.deceased).to.eq('euthanized');
        expect(other?.deceased ?? null).to.eq(null);
      },
    );

    const recap = stubScribeClientRecap({ euthanasia: true });
    signIn(wrapUpPath(juniper, clientId));
    cy.contains('Client recap', { timeout: 30000 }).should('exist');

    // One recap request for the household, covering the pet who died.
    cy.wrap(null).should(() => expect(recap.count()).to.eq(1));
    cy.wrap(null).then(() => {
      const body = recap.requests()[0] as { patientIds?: number[] } | undefined;
      if (body?.patientIds?.length) expect(body.patientIds).to.include(juniper.patientId);
    });

    // Subject per D1, and the doctor still decides.
    cy.get('input.soap-input').filter((_, el) => (el as HTMLInputElement).value === 'Thinking of you and Juniper').should('have.length', 1);
    cy.contains('button', 'Send to client').should('be.enabled');
    cy.contains('button', "Don't email").click();
    cy.contains('button', 'Record: no recap').should('be.visible');
  });
});

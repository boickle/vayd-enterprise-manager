/// <reference types="cypress" />
import '../support/e2e';
import { stubScribeStructure } from '../support/scribeStubs';

/**
 * AI-scribe Wave 1 Batch A, end to end: SCR-01-4, SCR-04-3, SCR-05-3 (plan: vayd-api docs/test-plans/ai-scribe.md).
 *
 * Seed (a database whose name contains "test"), from vayd-api:
 *   npx ts-node -T test/scripts/scribe-e2e-seed.ts seed vayd_api_test_e2e /tmp/scribe-world.json
 * Run, with the dev server and an API on the same database (CONTROL_DB_ENABLED=false GMAIL_POLL_INTERVAL_MS=0):
 *   CYPRESS_SCRIBE_WORLD="$(cat /tmp/scribe-world.json)" CYPRESS_E2E_DB=vayd_api_test_e2e \
 *     npx cypress run --spec cypress/e2e/scr-wave1a.cy.ts
 * Needs psql on the PATH (reads and writes the test database like emrSql does). The AI answers come from
 * cypress/support/scribeStubs.ts; nothing reaches an LLM, Stripe or Gmail. Invented names only.
 * The seed has no "scribeWorld" loader yet, so a small one is inlined below.
 * Each test resets the household's charts first (the seed's hand-written text for Basil, empty for Aster).
 */
type Role = 'veterinarian' | 'technician' | 'practice_manager';
type Pet = { patientId: number; name: string; species: string; appointmentId: number; encounterId: string };
type ScribeWorld = {
  practiceId: number;
  auth: Record<Role, { Authorization: string; token: string }>;
  handWritten: { objectiveNotes: string; assessmentReasoning: string; planNotes: string };
  households: { household: { clientId: number; pets: Pet[] } };
};

const world = (): ScribeWorld => {
  const raw = Cypress.env('SCRIBE_WORLD') as string | ScribeWorld | undefined;
  if (!raw) throw new Error('Set CYPRESS_SCRIBE_WORLD to the JSON from test/scripts/scribe-e2e-seed.ts');
  return typeof raw === 'string' ? (JSON.parse(raw) as ScribeWorld) : raw;
};

const dbName = () => String(Cypress.env('E2E_DB') || 'vayd_api_test_e2e');
const q = (v: string) => `'${v.replace(/'/g, "''")}'`;

/** One SQL statement on the dedicated test database; refuses anything not named "test". */
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

const chartText = (encounterId: string, column: 'objectiveNotes' | 'assessmentReasoning' | 'planNotes') =>
  sql(`SELECT coalesce("${column}", '') FROM soap_encounters WHERE id = '${encounterId}'`);

function resetHousehold() {
  const w = world();
  const [a, b] = w.households.household.pets;
  const h = w.handWritten;
  sql(`DELETE FROM scribe_learning_pairs WHERE "soapEncounterId" IN ('${a.encounterId}','${b.encounterId}')`);
  sql(`DELETE FROM soap_scribe_sessions WHERE "soapEncounterId" IN ('${a.encounterId}','${b.encounterId}')`);
  sql(`UPDATE soap_encounters SET subjective = NULL, "objectiveNotes" = NULL, "assessmentReasoning" = NULL, "planNotes" = NULL WHERE id = '${a.encounterId}'`);
  sql(
    `UPDATE soap_encounters SET "objectiveNotes" = ${q(h.objectiveNotes)}, "assessmentReasoning" = ${q(h.assessmentReasoning)}, "planNotes" = ${q(h.planNotes)} WHERE id = '${b.encounterId}'`,
  );
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

const soapPath = (pet: Pet, clientId: number) => `/schedule/soap/${pet.appointmentId}/${pet.patientId}?clientId=${clientId}`;

const TRANSCRIPT = 'Doctor: Aster looks great. Basil has been vomiting. Client: Thank you.';

function openAndProcess(pet: Pet, clientId: number, structure: ReturnType<typeof stubScribeStructure>) {
  signIn(soapPath(pet, clientId));
  cy.contains('button', /AI Scribe/i, { timeout: 30000 }).click();
  cy.contains('button', /Paste transcript/).click();
  cy.contains(/Which pets are covered/).should('be.visible');
  cy.get('textarea.soap-scribe-paste-textarea').type(TRANSCRIPT, { delay: 0 });
  cy.contains('button', /^Process$/).click();
  return structure;
}

describe('AI scribe Wave 1A (SCR-01, SCR-04, SCR-05)', () => {
  let structure: ReturnType<typeof stubScribeStructure>;
  beforeEach(() => {
    resetHousehold();
    // Only /scribe/structure is stubbed: the real API answers the sessions and saves the transcripts.
    structure = stubScribeStructure({ household: true });
  });

  it('SCR-01-4 skipping Basil leaves her hand-written notes exactly as written, in the database', () => {
    const w = world();
    const { clientId, pets } = w.households.household;
    const [aster, basil] = pets;
    openAndProcess(aster, clientId, structure);

    cy.contains(/Other pets already have notes/).should('be.visible');
    cy.contains('[role="dialog"]', 'Basil').should('be.visible');
    cy.contains('button', 'Skip those pets').click();

    cy.wrap(null).should(() => expect(structure.count()).to.be.greaterThan(0));
    // Aster is filled with the stubbed AI text.
    cy.contains(/AI-WRITTEN/, { timeout: 20000 }).should('exist');
    chartText(aster.encounterId, 'planNotes').should('contain', 'AI-WRITTEN PLAN');
    // Basil's chart in the database is exactly what the doctor wrote.
    chartText(basil.encounterId, 'objectiveNotes').should('eq', w.handWritten.objectiveNotes);
    chartText(basil.encounterId, 'assessmentReasoning').should('eq', w.handWritten.assessmentReasoning);
    chartText(basil.encounterId, 'planNotes').should('eq', w.handWritten.planNotes);

    // Open Basil's tab: still her notes.
    signIn(soapPath(basil, clientId));
    cy.contains(w.handWritten.planNotes.slice(0, 30), { timeout: 30000 }).should('exist');
    chartText(basil.encounterId, 'planNotes').should('eq', w.handWritten.planNotes);
  });

  it('SCR-04-3 a cleared Assessment stays cleared after leaving and reopening', () => {
    const w = world();
    const { clientId, pets } = w.households.household;
    const [aster] = pets;
    openAndProcess(aster, clientId, structure);
    // Basil has notes, so the household confirm appears: overwrite them, it is not what is tested here.
    cy.contains('button', 'Overwrite all').click();
    chartText(aster.encounterId, 'assessmentReasoning').should('contain', 'Healthy adult dog');

    // The doctor clears the Assessment (saved blank), leaves and reopens the chart.
    sql(`UPDATE soap_encounters SET "assessmentReasoning" = '' WHERE id = '${aster.encounterId}'`);
    signIn('/schedule');
    signIn(soapPath(aster, clientId));
    cy.contains('button', /AI Scribe/i, { timeout: 30000 }).should('exist');
    cy.wait(3000); // the restore on open runs after the sessions load
    chartText(aster.encounterId, 'assessmentReasoning').should('eq', '');
  });

  it('SCR-05-3 Delete transcript on Aster leaves no transcript on either chart, even after a reload', () => {
    const w = world();
    const { clientId, pets } = w.households.household;
    const [aster, basil] = pets;
    // /scribe/structure is stubbed in this spec, so the server never saves a transcript itself.
    // Set up what a household Process leaves behind: the same transcript (and a learning row) on both charts.
    cy.fixture('scribe/structure-single.json').then((suggestion) => {
    for (const pet of [aster, basil]) {
      sql(
        `WITH s AS (INSERT INTO soap_scribe_sessions ("practiceId","soapEncounterId",status,transcript,"lastSuggestion","endedAt")
           VALUES (${w.practiceId}, '${pet.encounterId}', 'stopped', ${q(TRANSCRIPT)}, ${q(JSON.stringify(suggestion))}::jsonb, now()) RETURNING id)
         INSERT INTO scribe_learning_pairs ("practiceId",kind,"patientId","clientId","appointmentId","soapEncounterId","scribeSessionId",transcript,generated,"generatedAt")
           SELECT ${w.practiceId}, 'soap', ${pet.patientId}, ${clientId}, ${pet.appointmentId}, '${pet.encounterId}', s.id, ${q(TRANSCRIPT)}, '{}'::jsonb, now() FROM s`,
      );
    }
    });
    signIn(soapPath(aster, clientId));
    cy.contains('button', /AI Scribe/i, { timeout: 30000 }).click();
    // Both charts carry the transcript.
    sql(`SELECT count(*) FROM soap_scribe_sessions WHERE "soapEncounterId" IN ('${aster.encounterId}','${basil.encounterId}') AND transcript <> ''`)
      .should('eq', '2');

    cy.contains('button', /Combined transcript/).click();
    cy.contains('button', /Delete transcript/).click();
    cy.contains('button', /^Delete$/).click();

    sql(`SELECT count(*) FROM soap_scribe_sessions WHERE "soapEncounterId" IN ('${aster.encounterId}','${basil.encounterId}') AND transcript <> ''`)
      .should('eq', '0');
    sql(`SELECT count(*) FROM scribe_learning_pairs WHERE "soapEncounterId" IN ('${aster.encounterId}','${basil.encounterId}') AND transcript <> ''`)
      .should('eq', '0');
    // Rows and the AI suggestion are kept.
    sql(`SELECT count(*) FROM soap_scribe_sessions WHERE "soapEncounterId" IN ('${aster.encounterId}','${basil.encounterId}') AND "lastSuggestion" IS NOT NULL`)
      .should('eq', '2');

    // Open Basil, then reload Aster: no transcript on either, nothing restored from the device.
    signIn(soapPath(basil, clientId));
    cy.contains('button', /AI Scribe/i, { timeout: 30000 }).should('exist');
    cy.contains('button', /Combined transcript/).should('not.exist');
    signIn(soapPath(aster, clientId));
    cy.contains('button', /AI Scribe/i, { timeout: 30000 }).should('exist');
    cy.contains('button', /Combined transcript/).should('not.exist');
    cy.contains('button', /Paste transcript/).should('exist');
  });
});

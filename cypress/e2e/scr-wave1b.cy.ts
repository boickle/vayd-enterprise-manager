/// <reference types="cypress" />
/**
 * SCR-07-3: a two-pet technician visit on the medical note. The AI write-up fills both pets;
 * Wrap up refuses until both tabs were opened, then signs two chart notes.
 *
 * Seed (vayd-api, a database whose name contains "test"):
 *   npx ts-node -T test/scripts/scribe-e2e-seed.ts seed vayd_api_test_scr_c /tmp/scribe-world.json
 *   CYPRESS_SCRIBE_WORLD="$(cat /tmp/scribe-world.json)" CYPRESS_E2E_DB=vayd_api_test_scr_c \
 *     npx cypress run --spec cypress/e2e/scr-wave1b.cy.ts
 * The API the dev server talks to must use the same database. The LLM is stubbed (stubVisitWriteup).
 * Not yet run: the coordinator runs it after merging.
 */
import { stubVisitWriteup } from '../support/scribeStubs';

type Pet = { patientId: number; name: string; appointmentId: number };
type World = {
  practiceId: number;
  auth: Record<'veterinarian' | 'technician' | 'practice_manager', { Authorization: string; token: string }>;
  households: { household: { clientId: number; pets: Pet[] } };
};

const world = (): World => {
  const raw = Cypress.env('SCRIBE_WORLD') as string | World | undefined;
  if (!raw) throw new Error('Set CYPRESS_SCRIBE_WORLD to the JSON from scribe-e2e-seed.ts');
  return typeof raw === 'string' ? (JSON.parse(raw) as World) : raw;
};

describe('SCR-07 medical note wrap-up needs every AI-filled pet viewed', () => {
  it('SCR-07-3: write up, open each tab, wrap up -> two finalized chart notes', () => {
    const w = world();
    const [a, b] = w.households.household.pets;
    const writeup = stubVisitWriteup({ household: true });

    cy.visit('/login');
    cy.window().then((win) => {
      win.localStorage.clear();
      win.localStorage.setItem('accessToken', w.auth.technician.token);
    });
    cy.visit(`/schedule/note/${a.appointmentId}/${a.patientId}?clientId=${w.households.household.clientId}`);

    cy.contains('button', 'Paste transcript').click();
    cy.get('textarea.med-note-transcript').type('Aster and Basil both came in for a recheck today.');
    cy.contains('button', 'Write up visit').click();
    cy.contains('Visit write-up is ready for all 2 pets').should('be.visible');
    cy.wrap(null).then(() => expect(writeup.count()).to.eq(1));

    // Pet B's tab was never opened: Wrap up is blocked and names the pet.
    cy.contains('button', 'Wrap up').click();
    cy.contains(`Review ${b.name} before signing`).should('exist');
    cy.location('pathname').should('include', '/schedule/note/');

    // The link in the message opens that tab; then wrap up signs both.
    cy.get('[role="alert"]').contains('button', b.name).click();
    cy.get('textarea.med-note-tab-textarea').first().should('contain.value', 'AI-WRITTEN HISTORY');
    cy.contains('button', 'Wrap up').click();
    cy.location('pathname').should('eq', '/schedule/home');

    for (const pet of [a, b]) {
      cy.request({
        url: `${Cypress.env('API_URL') || 'http://localhost:3000'}/scout-chart/notes?practiceId=${w.practiceId}&patientId=${pet.patientId}&status=finalized`,
        headers: { Authorization: w.auth.technician.Authorization },
        failOnStatusCode: false,
      }).then((res) => {
        expect(res.status).to.be.lessThan(300);
        const rows = Array.isArray(res.body) ? res.body : [];
        expect(rows.some((r: { body: string }) => /AI-WRITTEN/.test(r.body))).to.eq(true);
      });
    }
  });
});

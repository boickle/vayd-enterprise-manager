/// <reference types="cypress" />
import '../support/e2e';
import { cleanEmrWorld, emrApi, seedEmrWorld, type EmrWorld } from '../support/emrWorld';

/**
 * EMR-HIST (owner decision Nov 3, 2026): the pet's chart has a staff-only History tab listing the logged steps on
 * its prescriptions, vaccine doses edited after sign-off and in-house lab results, newest first. It is never printed
 * and never part of the records sent out. The seed logs three steps on Juniper (lab completed, rabies tag changed,
 * Rx label printed).
 *
 *   EMR_DB=<test db> CYPRESS_EMR_DB=<test db> npx cypress run --spec cypress/e2e/emr-hist-pet-record-history.cy.ts
 *
 * The dev API must use the same test database. Nothing is charged or sent.
 */
describe('EMR-HIST: pet record History on the chart', () => {
  let world: EmrWorld;

  before(() => seedEmrWorld().then((w) => (world = w)));
  after(() => cleanEmrWorld());

  beforeEach(() => {
    cy.visit('/login');
    cy.window().then((win) => {
      win.localStorage.clear();
      win.localStorage.setItem('accessToken', world.staff.token);
    });
    cy.viewport(1440, 1000);
    cy.visit(`/schedule/patients?patientId=${world.recordHistory.patientId}`);
  });

  it('EMR-HIST-1: staff open History and see lab, dose and Rx steps, newest first', () => {
    const { labText, doseText, rxText } = world.recordHistory;
    cy.contains('[role="tab"]', /^History$/, { timeout: 40000 }).click();
    cy.get('[aria-label="Pet record history"]', { timeout: 20000 }).within(() => {
      cy.get('tbody tr').should('have.length.at.least', 3);
      cy.get('tbody tr').eq(0).should('have.attr', 'data-history-entity', 'lab_result').and('contain.text', labText);
      cy.get('tbody tr').eq(1).should('have.attr', 'data-history-entity', 'vaccination').and('contain.text', doseText);
      cy.get('tbody tr').eq(2).should('have.attr', 'data-history-entity', 'prescription').and('contain.text', rxText);
      cy.contains('Lab result · Heartworm snap').should('exist');
      cy.contains('Vaccine dose · Rabies 3yr Vaccine dose').should('exist');
    });
  });

  it('EMR-HIST-2: the History is hidden when the chart prints', () => {
    cy.contains('[role="tab"]', /^History$/, { timeout: 40000 }).click();
    cy.get('[aria-label="Pet record history"]', { timeout: 20000 }).should('be.visible');
    cy.document().then((doc) => {
      const rules = Array.from(doc.styleSheets).flatMap((sheet) => {
        try {
          return Array.from(sheet.cssRules);
        } catch {
          return [];
        }
      });
      const printHides = rules.some(
        (r) =>
          r instanceof CSSMediaRule &&
          /print/.test(r.conditionText ?? r.media.mediaText) &&
          Array.from(r.cssRules).some(
            (inner) => inner instanceof CSSStyleRule && /\.record-history\b/.test(inner.selectorText) && inner.style.display === 'none',
          ),
      );
      expect(printHides, 'print stylesheet hides .record-history').to.equal(true);
    });
  });

  it('EMR-HIST-3: the history never reaches the medical record the outputs are built from', () => {
    const { labText, doseText, rxText } = world.recordHistory;
    emrApi(world, 'GET', `/patients/${world.recordHistory.patientId}/medical-record`).then((res) => {
      expect(res.status).to.equal(200);
      const text = JSON.stringify(res.body);
      for (const needle of [labText, doseText, rxText, 'A12-TAG-0B', 'result_completed', 'dose_changed', 'label_printed']) {
        expect(text, needle).not.to.contain(needle);
      }
    });
    emrApi(world, 'GET', `/record-history/patient?practiceId=${world.practiceId}&patientId=${world.recordHistory.patientId}`).then((res) => {
      expect(res.status).to.equal(200);
      expect(res.body.map((e: { text: string }) => e.text)).to.include.members([labText, doseText, rxText]);
    });
  });
});

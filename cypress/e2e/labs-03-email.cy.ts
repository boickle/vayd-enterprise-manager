/// <reference types="cypress" />
import '../support/e2e';
import {
  cleanLabsWorld,
  labsApi,
  labsWorld,
  seedLabsWorld,
  signInLabs,
} from '../support/labsWorld';

/**
 * LAB-03-5 (written, not run): a vet approves a current summary on a complete, reviewed result and
 * emails it. Needs the Labs stack: API with IDEXX_FAKE_STATE and EMAIL_CAPTURE_PATH set.
 * Mail may only reach the seeded client's @vayd.test address (or deirdre@vetatyourdoor.com if the stack redirects).
 * Run: CYPRESS_LABS_DB=<test db> npx cypress run --spec cypress/e2e/labs-03-email.cy.ts
 */
const SUMMARY = 'Max is doing well. His blood sugar and kidney values are normal.';

describe('LABS-03: email lab results', () => {
  before(() => {
    seedLabsWorld();
  });
  after(() => {
    cleanLabsWorld();
  });

  it('LAB-03-5: vet approves a current summary; Email lab summary & report sends it with the PDF, only to the test inbox, and the chart logs it', () => {
    const w = labsWorld();
    const hh = w.households.two;
    const max = hh.pets.find((p) => p.name === 'Max')!;
    const resultId = `labs03-${Date.now()}`;
    const statePath = Cypress.env('IDEXX_FAKE_STATE');
    cy.writeFile(statePath, {
      results: [
        {
          resultId,
          orderId: null,
          status: 'COMPLETE',
          modality: 'REFLAB',
          patient: { name: max.name, clientLastName: 'Labtest', patientId: String(max.patientId) },
          categories: [
            {
              name: 'Chemistry',
              tests: [
                {
                  name: 'Glucose',
                  code: 'GLU',
                  result: '95',
                  resultNumeric: 95,
                  units: 'mg/dL',
                  status: 'COMPLETE',
                },
              ],
            },
          ],
          updatedDate: new Date().toISOString(),
        },
      ],
    });
    labsApi('veterinarian', 'POST', '/idexx/results/sync');
    cy.writeFile(statePath, {});
    cy.clearCapturedEmails();

    labsApi<{ items: Array<{ id: number; idexxResultId: string }> }>(
      'veterinarian',
      'GET',
      `/idexx/results?patientId=${max.patientId}&limit=50`
    ).then((res) => {
      const id = res.items.find((i) => i.idexxResultId === resultId)!.id;
      // Reviewed, then the summary saved and approved as the vet (no reason needed).
      labsApi('veterinarian', 'PATCH', `/idexx/results/${id}/reviewed`, { reviewed: true });
      labsApi('veterinarian', 'PUT', `/idexx/results/${id}/client-summary`, {
        summary: SUMMARY,
        approved: true,
      });

      // Reviewed results leave "Needs review", so open under All recent.
      signInLabs('veterinarian', '/schedule/idexx-results');
      cy.contains('[role="tab"]', 'All recent', { timeout: 30000 }).click();
      cy.get('.idexx-result-list__row', { timeout: 30000 })
        .first()
        .find('button[aria-label^="Expand"]')
        .click();
      cy.contains('button', 'Email lab summary & report', { timeout: 30000 })
        .should('not.be.disabled')
        .click();

      cy.intercept('POST', '**/gmail/messages/send*').as('sendEmail');
      cy.intercept('POST', '**/scout-chart/communications*').as('chartLog');
      cy.get('[role="dialog"]', { timeout: 30000 }).within(() => {
        cy.contains('Email lab summary & report').should('exist');
        cy.contains(/\.pdf/i).should('exist');
        cy.get('[contenteditable="true"], textarea')
          .invoke('text')
          .should('contain', 'Max is doing well');
        cy.contains('button', 'Send email').click();
      });
      // The send goes through Gmail; the test stack captures it instead of reaching Google.
      cy.wait('@sendEmail', { timeout: 60000 }).its('response.statusCode').should('be.lessThan', 300);

      cy.capturedEmails().should((mails: any[]) => {
        expect(mails, 'one email captured').to.have.length(1);
        const to = JSON.stringify(mails[0].to ?? '').toLowerCase();
        expect(to).to.match(/@vayd\.test|deirdre@vetatyourdoor\.com/);
        expect(to).to.not.match(/@(?!vayd\.test)(?!vetatyourdoor\.com)[a-z0-9.-]+/);
        expect(JSON.stringify(mails[0])).to.contain('Max is doing well');
      });

      // The chart logged it against the client.
      // The screen logs the email with its own request right after the send; wait for it before reading back.
      cy.wait('@chartLog', { timeout: 60000 }).its('response.statusCode').should('be.lessThan', 300);
      labsApi<Array<{ typeLabel: string; message: string }>>(
        'veterinarian',
        'GET',
        `/scout-chart/communications?practiceId=${w.practiceId}&clientId=${hh.clientId}`
      ).then((rows) => {
        expect(
          rows.some(
            (r) => r.typeLabel === 'IDEXX results email' && r.message.includes('Max is doing well')
          )
        ).to.equal(true);
      });
    });
  });
});

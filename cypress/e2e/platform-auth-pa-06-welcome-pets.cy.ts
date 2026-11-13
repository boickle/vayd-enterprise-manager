/// <reference types="cypress" />
/**
 * PA-06-4 (docs/test-plans/platform-auth-and-tenancy.md in vayd-api): screen to email. Staff opens a client with no
 * portal login (one active pet, one passed away), clicks "Send Reset Password" and confirms "Send"; the screen says
 * "Portal invite sent" and the captured email names only the active pet.
 *
 * NOT RUN YET. The orchestrator runs it with the PA seed (cypress/support/paWorld.ts: PA_DB=vayd_api_test_<x>), the
 * test API on the same database, and EMAIL_CAPTURE_PATH set so the email is captured (never delivered).
 */
import '../support/e2e';
import { cleanPaWorld, paWorld, seedPaWorld, emailMeantFor } from '../support/paWorld';

describe('PA-06-4: the portal invite names only the active pet', () => {
  before(() => {
    seedPaWorld();
  });
  after(() => {
    cleanPaWorld();
  });

  it('staff sends the invite and the email names Max, not Bella', () => {
    const { client, staff } = paWorld();
    cy.clearCapturedEmails();

    cy.visit('/login');
    cy.get('input[aria-label="Email"]').type(staff.email);
    cy.get('input[aria-label="Password"]').type(staff.password, { log: false });
    cy.get('form[aria-label="Login form"] button[type="submit"]').click();
    cy.location('pathname', { timeout: 20000 }).should('not.include', '/login');

    cy.visit(`/schedule/clients?clientId=${client.clientId}`);
    cy.contains('button', 'Send Reset Password', { timeout: 20000 }).click();
    cy.contains('Send reset password?').should('be.visible');
    cy.contains('button', /^Send$/).click();
    cy.contains('Portal invite sent').should('be.visible');

    cy.capturedEmails().then((emails) => {
      const mail = (emails as Array<{ to: string | string[]; html?: string; text?: string }>).find((e) =>
        emailMeantFor(e, client.email),
      );
      expect(mail, 'invite email to the client').to.exist;
      const body = `${mail?.html ?? ''} ${mail?.text ?? ''}`;
      expect(body).to.contain(client.activePetName);
      expect(body).not.to.contain(client.inactivePetName);
    });
  });
});

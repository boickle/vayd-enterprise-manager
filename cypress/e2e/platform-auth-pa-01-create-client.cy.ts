/// <reference types="cypress" />
/**
 * PA-01-6 (docs/test-plans/platform-auth-and-tenancy.md in vayd-api): screen to database. A client with no portal
 * login opens the public /create-client page, enters their email and sees the status screen; the response the
 * browser got holds no secrets; the emailed link sets a password; the portal then shows the client's own pets.
 *
 * NOT RUN YET. The orchestrator runs it with the PA seed (cypress/support/paWorld.ts: PA_DB=vayd_api_test_<x>), the
 * test API on the same database, and EMAIL_CAPTURE_PATH set so the welcome email is captured (never delivered).
 */
import '../support/e2e';
import { cleanPaWorld, paWorld, seedPaWorld, emailMeantFor } from '../support/paWorld';

describe('PA-01-6: public create-account page gives nothing away and the emailed link works', () => {
  before(() => {
    seedPaWorld();
  });
  after(() => {
    cleanPaWorld();
  });

  it('shows the status screen, leaks no secrets, and the emailed link opens the right portal', () => {
    const { client } = paWorld();
    const newPassword = `Pa01-${Date.now()}-Ok!`;
    cy.clearCapturedEmails();
    cy.intercept('POST', '**/users/create-client').as('createClient');

    cy.visit('/create-client');
    cy.get('input[aria-label="Email"]').type(client.email);
    cy.contains('button', 'Send My Portal Link').click();

    cy.wait('@createClient').then(({ response }) => {
      expect(response?.statusCode, 'status').to.be.oneOf([200, 201]);
      expect(response?.body, 'body').to.deep.equal({ ok: true });
      const text = JSON.stringify(response?.body);
      ['tempPassword', 'resetCode', 'password'].forEach((k) => expect(text).not.to.contain(k));
    });
    // The non-production banner is fixed at the top; scroll each line clear of it before checking it shows.
    cy.contains('Check').scrollIntoView({ offset: { top: -120, left: 0 } }).should('be.visible');
    cy.contains(client.email).scrollIntoView({ offset: { top: -120, left: 0 } }).should('be.visible');

    cy.capturedEmails().then((emails) => {
      const mail = (emails as Array<{ to: string | string[]; html?: string; text?: string }>).find((e) =>
        emailMeantFor(e, client.email),
      );
      expect(mail, 'welcome email to the client').to.exist;
      const m = /(https?:\/\/[^\s"<]+[?&]token=[^\s"<]+)/.exec(`${mail?.html ?? ''} ${mail?.text ?? ''}`);
      expect(m, 'link with a token').to.not.be.null;
      const url = new URL(m![1].replace(/&amp;/g, '&'));

      cy.visit(`${url.pathname}${url.search}`);
      cy.get('input[placeholder="At least 8 characters"]').type(newPassword);
      cy.get('input[placeholder="Re-enter your password"]').type(newPassword);
      cy.contains('button', 'Update Password').click();
    });

    cy.visit('/login');
    cy.get('input[aria-label="Email"]').type(client.email);
    cy.get('input[aria-label="Password"]').type(newPassword);
    cy.get('form[aria-label="Login form"] button[type="submit"]').click();

    cy.location('pathname', { timeout: 20000 }).should('include', '/client-portal');
    cy.contains(client.activePetName, { timeout: 20000 }).should('be.visible');
  });
});

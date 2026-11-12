/// <reference types="cypress" />
/**
 * PA-02-8 (docs/test-plans/platform-auth-and-tenancy.md in vayd-api): a staff login holding a temporary password
 * (requiresPasswordReset) still gets through. Signing in opens the reset screen with the email and a one-time code;
 * the screen sends both (a code alone is refused since PA-02); the new password works and the old one doesn't.
 *
 * NOT RUN YET. The orchestrator runs it with the PA seed (cypress/support/paWorld.ts: PA_DB=vayd_api_test_<x>) and the
 * test API on the same database.
 */
import '../support/e2e';
import { cleanPaWorld, paWorld, seedPaWorld } from '../support/paWorld';

function signIn(email: string, password: string) {
  cy.visit('/login');
  cy.get('input[aria-label="Email"]').clear().type(email);
  cy.get('input[aria-label="Password"]').clear().type(password, { log: false });
  cy.get('form[aria-label="Login form"] button[type="submit"]').click();
}

describe('PA-02-8: temporary-password sign-in still works', () => {
  before(() => {
    seedPaWorld();
  });
  after(() => {
    cleanPaWorld();
  });

  it('opens the reset screen with code and email, and only the new password works afterwards', () => {
    const { tempStaff } = paWorld();
    const newPassword = `Pa02-${Date.now()}-Ok!`;
    cy.intercept('POST', '**/auth/login').as('login');
    cy.intercept('POST', '**/users/reset-password/complete').as('complete');

    signIn(tempStaff.email, tempStaff.tempPassword);
    cy.wait('@login').then(({ response }) => {
      expect(response?.statusCode).to.eq(200);
      const body = response?.body ?? {};
      expect(body.user?.requiresPasswordReset, 'must reset').to.eq(true);
      ['resetPasswordCode', 'passwordResetTokenHash', 'passwordResetExpiresAt', 'password'].forEach((k) =>
        expect(body.user ?? {}, k).not.to.have.property(k),
      );
      expect(String(body.resetCode), 'one-time code').to.match(/^[0-9]{6}$/);
    });

    cy.location('pathname', { timeout: 20000 }).should('eq', '/reset-password');
    cy.contains(tempStaff.email).should('be.visible');
    cy.get('[data-testid="reset-email"]').should('have.value', tempStaff.email);

    cy.get('input[placeholder="At least 8 characters"]').type(newPassword, { log: false });
    cy.get('input[placeholder="Re-enter your password"]').type(newPassword, { log: false });
    cy.contains('button', 'Update Password').click();

    cy.wait('@complete').then(({ request, response }) => {
      expect(request.body.email, 'email sent with the code').to.eq(tempStaff.email);
      expect(String(request.body.token), 'code').to.match(/^[0-9]{6}$/);
      expect(response?.statusCode).to.eq(200);
    });
    cy.contains('Password updated').should('be.visible');
    cy.location('pathname', { timeout: 20000 }).should('eq', '/login');

    // The old temporary password no longer works.
    signIn(tempStaff.email, tempStaff.tempPassword);
    cy.wait('@login').its('response.statusCode').should('eq', 401);
    cy.location('pathname').should('eq', '/login');

    // The new one does, and no longer asks for a reset.
    signIn(tempStaff.email, newPassword);
    cy.wait('@login').then(({ response }) => {
      expect(response?.statusCode).to.eq(200);
      expect(response?.body?.user?.requiresPasswordReset).to.eq(false);
      expect(response?.body).not.to.have.property('resetCode');
    });
    cy.location('pathname', { timeout: 20000 }).should('not.include', 'reset');
    cy.location('pathname').should('not.eq', '/login');
  });
});

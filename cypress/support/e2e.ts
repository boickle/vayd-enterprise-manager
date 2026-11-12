// ***********************************************************
// This example support/e2e.ts is processed and
// loaded automatically before your test files.
//
// This is a great place to put global configuration and
// behavior that modifies Cypress.
//
// You can change the location of this file or turn off
// automatically serving support files with the
// 'supportFile' configuration option.
//
// You can read more here:
// https://on.cypress.io/configuration
// ***********************************************************

// Import commands.js using ES2015 syntax:
import './commands';

// Alternatively you can use CommonJS syntax:
// require('./commands')

declare global {
  namespace Cypress {
    interface Chainable {
      /** UI login — fills the login form. Slower; prefer apiLogin() in most specs. */
      loginAs(userType: 'client' | 'employee', email?: string, password?: string): Chainable<void>;

      /**
       * H3: Fast API-level login. Calls POST /auth/login, stores the JWT in
       * localStorage, then navigates to startPath (defaults to /home or /client-portal).
       * @example cy.apiLogin('employee');
       * @example cy.apiLogin('client', { startPath: '/client-portal' });
       */
      apiLogin(
        role: 'client' | 'employee',
        opts?: { email?: string; password?: string; startPath?: string },
      ): Chainable<void>;

      /** Verify current route. */
      shouldBeOnRoute(route: string): Chainable<void>;

      /** Assert employee navigation tabs are NOT visible (client view). */
      shouldNotHaveEmployeeTabs(): Chainable<void>;

      /** Assert employee navigation tabs ARE visible. */
      shouldHaveEmployeeTabs(): Chainable<void>;

      /**
       * H3: Read emails captured to the EMAIL_CAPTURE_PATH file.
       * Returns [] when the file is empty or the path is not configured.
       */
      capturedEmails(): Chainable<unknown[]>;

      /** H3: Truncate the captured-emails file before a test. */
      clearCapturedEmails(): Chainable<void>;

      /**
       * H3: Seed test data via the backend test-support endpoint.
       * Requires TEST_SUPPORT_KEY in cypress.env.json and NODE_ENV=test on the API.
       */
      seed(fixture: Record<string, unknown>): Chainable<void>;

      /**
       * H3: Clean up data seeded by cy.seed().
       * Safe to call even when TEST_SUPPORT_KEY is missing.
       */
      cleanUp(refs?: Record<string, unknown>): Chainable<void>;

      /** H-INV: seed the inventory world; yields its ids, lot numbers and employee bearer headers. */
      seedInventory(options?: Record<string, unknown> | true): Chainable<Record<string, any>>;

      /** H-INV: remove a world returned by seedInventory(). */
      cleanUpInventory(world: Record<string, unknown>): Chainable<void>;
    }
  }
}


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
      /**
       * Custom command to login as a specific user type
       * @example cy.loginAs('client', 'client@example.com', 'password')
       * @example cy.loginAs('employee', 'employee@example.com', 'password')
       */
      loginAs(
        userType: 'client' | 'employee',
        email?: string,
        password?: string
      ): Chainable<void>;

      /**
       * Custom command to verify current route
       * @example cy.shouldBeOnRoute('/client-portal')
       */
      shouldBeOnRoute(route: string): Chainable<void>;

      /**
       * Custom command to check if element should not exist (for clients on employee pages)
       * @example cy.shouldNotHaveEmployeeTabs()
       */
      shouldNotHaveEmployeeTabs(): Chainable<void>;

      /**
       * Custom command to check if employee tabs are visible
       * @example cy.shouldHaveEmployeeTabs()
       */
      shouldHaveEmployeeTabs(): Chainable<void>;
    }
  }
}


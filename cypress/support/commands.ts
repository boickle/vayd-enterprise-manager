/// <reference types="cypress" />

/**
 * Get test credentials from environment (supports both cypress.env.json and process.env)
 */
function getTestCredential(key: string): string {
  // Cypress automatically loads cypress.env.json and makes it available via Cypress.env()
  // Environment variables can override: CYPRESS_CLIENT_EMAIL, etc.
  const value = Cypress.env(key);
  
  if (!value) {
    throw new Error(
      `Missing test credential: ${key}. ` +
      `Please set it in cypress.env.json or as environment variable CYPRESS_${key}. ` +
      `See TEST_CREDENTIALS.md for setup instructions.`
    );
  }
  
  return value;
}

/**
 * Login as a specific user type and verify redirect
 */
Cypress.Commands.add(
  'loginAs',
  (userType: 'client' | 'employee', email?: string, password?: string) => {
    // Use provided credentials or get from environment
    const userEmail = email || getTestCredential(userType === 'client' ? 'CLIENT_EMAIL' : 'EMPLOYEE_EMAIL');
    const userPassword = password || getTestCredential(userType === 'client' ? 'CLIENT_PASSWORD' : 'EMPLOYEE_PASSWORD');

    cy.visit('/login');

    // Wait for login form to be ready and fill email
    cy.get('input[type="email"]', { timeout: 10000 })
      .should('be.visible')
      .should('not.be.disabled')
      .clear()
      .type(userEmail);
    
    // Password field should be enabled after email is filled
    cy.get('input[type="password"]')
      .should('be.visible')
      .should('not.be.disabled')
      .clear()
      .type(userPassword);
    
    // Submit button should be enabled
    cy.get('button[type="submit"]')
      .should('be.visible')
      .should('not.be.disabled')
      .click();

    // Wait for navigation after login
    cy.wait(1000);

    // Verify redirect based on user type
    if (userType === 'client') {
      cy.url().should('include', '/client-portal');
    } else {
      cy.url().should('satisfy', (url) => {
        return url.includes('/home') || url.includes('/routing') || url.includes('/doctor');
      });
    }
  }
);

/**
 * Verify current route
 */
Cypress.Commands.add('shouldBeOnRoute', (route: string) => {
  cy.url().should('include', route);
});

/**
 * Verify employee tabs are NOT visible (client view)
 */
Cypress.Commands.add('shouldNotHaveEmployeeTabs', () => {
  // Employee tabs should not exist in the navbar
  cy.get('body').then(($body) => {
    // Check that navigation tabs (which employees see) are not present
    // This assumes the navbar structure from App.tsx
    if ($body.find('nav').length > 0) {
      // If there's a nav element, it shouldn't have employee-specific content
      cy.get('nav').should('not.contain', 'Routing');
      cy.get('nav').should('not.contain', 'My Day');
    }
  });
});

/**
 * Verify employee tabs ARE visible
 */
Cypress.Commands.add('shouldHaveEmployeeTabs', () => {
  // Check that employee navigation is present
  cy.get('nav').should('exist');
  // You can add more specific checks based on your actual tab structure
});

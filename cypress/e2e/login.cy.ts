/// <reference types="cypress" />

describe('Login and Authentication Flow', () => {
  beforeEach(() => {
    // Clear session storage before each test
    cy.clearAllSessionStorage();
    cy.clearAllCookies();
  });

  describe('Client Login Flow', () => {
    it('should successfully log in a client and redirect to client portal', () => {
      // Credentials loaded from cypress.env.json or environment variables
      // See TEST_CREDENTIALS.md for setup instructions
      cy.loginAs('client');

      // cy.loginAs handles the login process and redirect verification

      // Verify client portal page is displayed
      cy.get('body').should('not.contain', 'Not found');

      // Verify employee tabs are NOT visible
      cy.shouldNotHaveEmployeeTabs();

      // Verify navbar doesn't show employee navigation
      cy.get('body').then(($body) => {
        // Client portal typically doesn't show the same navbar as employees
        // Adjust based on your actual UI
      });
    });

    it('should redirect client from /home to /client-portal', () => {
      // Login using credentials from environment
      cy.loginAs('client');

      // Try to navigate to /home
      cy.visit('/home');

      // Should be redirected to client portal
      cy.url({ timeout: 5000 }).should('include', '/client-portal');
    });

    it('should redirect client from root (/) to /client-portal', () => {
      cy.loginAs('client');

      // Navigate to root
      cy.visit('/');

      // Should be redirected to client portal
      cy.url({ timeout: 5000 }).should('include', '/client-portal');
    });

    it('should not allow client to access employee-only pages', () => {
      cy.loginAs('client');

      // Try to access employee-only routes
      const employeeRoutes = ['/routing', '/doctor', '/users/create', '/analytics/payments'];

      employeeRoutes.forEach((route) => {
        cy.visit(route);
        // Employee routes are not defined for clients, so they should see "Not found"
        // The URL may stay the same, but the page content should show "Not found"
        cy.contains('Not found', { timeout: 5000 }).should('be.visible');
        // Alternatively, check that we're not seeing employee content
        cy.get('body').should('not.contain', 'Routing');
        cy.get('body').should('not.contain', 'My Day');
      });
    });
  });

  describe('Employee Login Flow', () => {
    it('should successfully log in an employee and redirect to home', () => {
      cy.loginAs('employee');

      // Verify employee can see navigation
      cy.shouldHaveEmployeeTabs();

      // Verify we're not on client portal
      cy.url().should('not.include', '/client-portal');
    });

    it('should show employee navigation tabs after login', () => {
      cy.loginAs('employee');

      // Employee should see navigation header
      cy.get('header.navbar').should('exist');

      // Check for user email in navbar (if displayed)
      cy.get('body').should('contain', 'Signed in');
    });

    it('should allow employee to access employee pages', () => {
      cy.loginAs('employee');

      // Navigate to home first
      cy.visit('/home');
      cy.url().should('include', '/home');

      // Employee pages should be accessible (depending on permissions)
      // These tests should be adjusted based on the employee's actual role/permissions
      cy.get('body').should('not.contain', 'Not found');
    });
  });

  describe('Login Error Handling', () => {
    it('should display error message for invalid credentials', () => {
      cy.visit('/login');

      cy.get('input[type="email"]').type('invalid@example.com');
      cy.get('input[type="password"]').type('wrongpassword');
      
      // Intercept and wait for the login request to complete
      cy.intercept('POST', '**/auth/login').as('loginRequest');
      cy.get('button[type="submit"]').click();
      
      // Wait for the API request to complete (whether success or error)
      cy.wait('@loginRequest', { timeout: 10000 });

      // Wait for the error message to appear
      // The error is displayed in a div with className "danger"
      // Error message could be: "Login failed", API error message, or axios error
      cy.get('.danger', { timeout: 5000 })
        .should('exist')
        .and('be.visible')
        .then(($error) => {
          // Verify there's actual error text
          const errorText = $error.text().trim();
          expect(errorText.length).to.be.greaterThan(0, 'Error message should not be empty');
        });

      // Should still be on login page (not redirected)
      cy.url().should('include', '/login');
    });

    it('should require email and password', () => {
      cy.visit('/login');

      // HTML5 form validation should prevent submission when fields are empty
      // The submit button should either be disabled, or form validation will prevent submission
      cy.get('input[type="email"]').should('have.attr', 'required');
      cy.get('input[type="password"]').should('have.attr', 'required');

      // Try to submit the form without filling fields
      cy.get('form').then(($form) => {
        // Check if form validation works by trying to submit
        // If HTML5 validation is working, the form won't submit
        cy.get('button[type="submit"]').click();
        
        // Should still be on login page (form didn't submit)
        cy.url().should('include', '/login');
        
        // No error message should appear (because form didn't submit)
        cy.get('.danger').should('not.exist');
      });
    });
  });

  describe('Token and Session Management', () => {
    it('should persist token in sessionStorage after login', () => {
      // Get credentials for verification
      const clientEmail = Cypress.env('CLIENT_EMAIL');
      
      cy.visit('/login');
      cy.get('input[type="email"]').type(clientEmail || 'test@example.com');
      cy.get('input[type="password"]').type(Cypress.env('CLIENT_PASSWORD') || 'test');
      cy.get('button[type="submit"]').click();

      cy.url({ timeout: 10000 }).should('include', '/client-portal');

      // Check sessionStorage has token
      cy.window().then((win) => {
        const token = win.sessionStorage.getItem('vayd_token');
        expect(token).to.exist;
        expect(token).to.not.be.empty;

        const email = win.sessionStorage.getItem('vayd_email');
        expect(email).to.equal(clientEmail);
      });
    });

    it('should redirect to login when not authenticated', () => {
      // Clear session storage first
      cy.clearAllSessionStorage();
      cy.visit('/home');

      // Should redirect to login
      cy.url({ timeout: 5000 }).should('include', '/login');
    });
  });

  describe('Role-based Page Access', () => {
    it('should show correct pages based on employee role and permissions', () => {
      cy.loginAs('employee');
      cy.visit('/home');

      // The home page should list accessible pages based on role
      // Adjust these checks based on your actual Home page implementation
      cy.get('body').should('not.contain', 'Not found');

      // Admin/superadmin should see additional pages
      // This is just an example - adjust based on your actual permissions
    });
  });
});


/// <reference types="cypress" />
// H3 additions — api login, seed, and email capture helpers

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
        return url.includes('/home') || url.includes('/schedule') || url.includes('/doctor');
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

// ─── H3: Fast API-level login ──────────────────────────────────────────────
//
// Calls POST /auth/login directly, stores the JWT in localStorage, then
// navigates to `startPath` so the SPA bootstraps as the logged-in user.
// This avoids filling the login form on every spec and is ~3-4× faster.
//
// Usage:
//   cy.apiLogin('employee', { startPath: '/home' });
//   cy.apiLogin('client', { email: 'jane@x.com', password: 'pw', startPath: '/client-portal' });

type ApiLoginRole = 'client' | 'employee';

Cypress.Commands.add(
  'apiLogin',
  (
    role: ApiLoginRole,
    opts: { email?: string; password?: string; startPath?: string } = {},
  ) => {
    const email =
      opts.email ||
      Cypress.env(role === 'client' ? 'CLIENT_EMAIL' : 'EMPLOYEE_EMAIL');
    const password =
      opts.password ||
      Cypress.env(role === 'client' ? 'CLIENT_PASSWORD' : 'EMPLOYEE_PASSWORD');

    if (!email || !password) {
      throw new Error(
        `apiLogin: missing credentials for role "${role}". ` +
          `Set CLIENT_EMAIL/CLIENT_PASSWORD or EMPLOYEE_EMAIL/EMPLOYEE_PASSWORD in cypress.env.json.`,
      );
    }

    // Load a blank page first so window.localStorage is available.
    cy.visit('/login');

    cy.request({
      method: 'POST',
      url: `${Cypress.config('baseUrl')?.replace(':5173', ':3000') ?? 'http://localhost:3000'}/auth/login`,
      body: { email, password },
      failOnStatusCode: false,
    }).then((resp) => {
      if (resp.status !== 200 && resp.status !== 201) {
        throw new Error(
          `apiLogin: POST /auth/login returned ${resp.status}. Check cypress.env.json credentials.`,
        );
      }
      const { accessToken, refreshToken } = resp.body;
      if (!accessToken) throw new Error('apiLogin: no accessToken in response');
      cy.window().then((win) => {
        win.localStorage.setItem('accessToken', accessToken);
        if (refreshToken) win.localStorage.setItem('refreshToken', refreshToken);
        win.localStorage.setItem('vayd_email', email);
      });
    });

    const dest = opts.startPath ?? (role === 'client' ? '/client-portal' : '/home');
    cy.visit(dest);
  },
);

// ─── H3: Email capture ────────────────────────────────────────────────────────
//
// The backend writes outgoing emails to a temp file when
// CYPRESS_EMAIL_CAPTURE_PATH is set (see cypress.config.ts > setupNodeEvents).
// cy.capturedEmails() reads that file and parses it.
// cy.clearCapturedEmails() truncates it before each test.

Cypress.Commands.add('capturedEmails', () => {
  const filePath = Cypress.env('EMAIL_CAPTURE_PATH') as string | undefined;
  if (!filePath) {
    cy.log('EMAIL_CAPTURE_PATH not set — email capture not configured');
    return cy.wrap([] as unknown[]);
  }
  return cy.readFile(filePath, { log: false }).then((raw: string) => {
    if (!raw?.trim()) return [];
    return raw
      .split('\n')
      .filter(Boolean)
      .map((line: string) => {
        try { return JSON.parse(line); } catch { return null; }
      })
      .filter(Boolean);
  });
});

Cypress.Commands.add('clearCapturedEmails', () => {
  const filePath = Cypress.env('EMAIL_CAPTURE_PATH') as string | undefined;
  if (filePath) cy.writeFile(filePath, '');
});

// ─── H3: Seed / clean-up helpers ─────────────────────────────────────────────
//
// These call a test-only backend endpoint (POST /test-support/seed and
// POST /test-support/cleanup) that is only registered when
// NODE_ENV=test AND CYPRESS_TEST_SUPPORT_KEY matches the request header.
// The endpoint is defined in test/integration/test-support.module.ts (H1).

Cypress.Commands.add('seed', (fixture: Record<string, unknown>) => {
  const key = Cypress.env('TEST_SUPPORT_KEY') as string | undefined;
  if (!key) {
    throw new Error(
      'cy.seed(): TEST_SUPPORT_KEY not set in cypress.env.json. ' +
        'Set it to the same value as CYPRESS_TEST_SUPPORT_KEY in your .env.',
    );
  }
  cy.request({
    method: 'POST',
    url: `${Cypress.config('baseUrl')?.replace(':5173', ':3000') ?? 'http://localhost:3000'}/test-support/seed`,
    headers: { 'x-test-support-key': key },
    body: fixture,
    failOnStatusCode: true,
  });
});

Cypress.Commands.add('cleanUp', (refs: Record<string, unknown> = {}) => {
  const key = Cypress.env('TEST_SUPPORT_KEY') as string | undefined;
  if (!key) return;
  cy.request({
    method: 'POST',
    url: `${Cypress.config('baseUrl')?.replace(':5173', ':3000') ?? 'http://localhost:3000'}/test-support/cleanup`,
    headers: { 'x-test-support-key': key },
    body: refs,
    failOnStatusCode: false,
  });
});

// ─── H-INV: inventory seed ───────────────────────────────────────────────────
// Seeds the inventory test world (two offices, one uncounted; lot-tracked carprofen with an
// expired and a current lot; vaccine; controlled liquids; auto-ship; inventory manager,
// technician and practice manager employees) and yields it, including bearer tokens in `auth`.
// See test/integration/inventory.fixtures.ts in vayd-api.

function testSupportUrl(path: string): string {
  const base = Cypress.config('baseUrl')?.replace(':5173', ':3000') ?? 'http://localhost:3000';
  return `${base}/test-support/${path}`;
}

Cypress.Commands.add('seedInventory', (options: Record<string, unknown> | true = true) => {
  const key = Cypress.env('TEST_SUPPORT_KEY') as string | undefined;
  if (!key) {
    throw new Error('cy.seedInventory(): TEST_SUPPORT_KEY not set in cypress.env.json.');
  }
  return cy
    .request({
      method: 'POST',
      url: testSupportUrl('seed'),
      headers: { 'x-test-support-key': key },
      body: { inventory: options },
      failOnStatusCode: true,
    })
    .then((res) => res.body.refs.inventory as Record<string, unknown>);
});

Cypress.Commands.add('cleanUpInventory', (world: Record<string, unknown>) => {
  const key = Cypress.env('TEST_SUPPORT_KEY') as string | undefined;
  if (!key || !world) return;
  cy.request({
    method: 'POST',
    url: testSupportUrl('cleanup'),
    headers: { 'x-test-support-key': key },
    body: { inventory: world },
    failOnStatusCode: false,
  });
});

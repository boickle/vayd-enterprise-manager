# Cypress E2E Testing Setup

## Overview

Cypress is configured for end-to-end testing of login flows and role-based routing. This setup ensures that:
- Client login works correctly and redirects to `/client-portal`
- Employee login works correctly and redirects to `/home` or appropriate pages
- Role-based access control functions properly
- Navigation and page display are correct for each user type

## Installation

1. Install dependencies:
```bash
npm install
```

Cypress will be installed as a dev dependency.

## Configuration

### Environment Variables

**📖 See [TEST_CREDENTIALS.md](./TEST_CREDENTIALS.md) for comprehensive credential management guide.**

Quick setup:

1. Run the setup script:
   ```bash
   npm run test:setup
   ```

2. Or manually copy the example file:
   ```bash
   cp cypress.env.example.json cypress.env.json
   ```

3. Edit `cypress.env.json` with your test credentials:
   ```json
   {
     "CLIENT_EMAIL": "your-test-client@example.com",
     "CLIENT_PASSWORD": "test-client-password",
     "EMPLOYEE_EMAIL": "your-test-employee@example.com",
     "EMPLOYEE_PASSWORD": "test-employee-password"
   }
   ```

**Important**: 
- ✅ `cypress.env.json` is already in `.gitignore` (never committed)
- ✅ Use dedicated test accounts, not production credentials
- ✅ For CI/CD, use environment variables instead (see TEST_CREDENTIALS.md)
- ✅ Share credentials securely with team members (password manager recommended)

### Base URL

The default base URL is set to `http://localhost:5173` (Vite dev server). To change it, edit `cypress.config.ts`:

```typescript
export default defineConfig({
  e2e: {
    baseUrl: 'http://localhost:5173', // Change this for different environments
    // ...
  }
});
```

## Running Tests

### Interactive Mode (Recommended for Development)

Opens the Cypress Test Runner with a GUI:

```bash
npm run test:e2e:open
```

### Headless Mode (CI/CD)

Runs all tests in headless mode:

```bash
npm run test:e2e
```

### Headed Mode (Debugging)

Runs tests in headless mode but with a visible browser:

```bash
npm run test:e2e:headed
```

## Test Structure

### Main Test File: `cypress/e2e/login.cy.ts`

This file contains comprehensive tests for:

1. **Client Login Flow**
   - Successful client login
   - Redirect to `/client-portal`
   - Automatic redirects from `/home` and `/` to `/client-portal`
   - Prevention of access to employee-only pages

2. **Employee Login Flow**
   - Successful employee login
   - Redirect to `/home` or appropriate page
   - Employee navigation visibility
   - Access to employee pages

3. **Error Handling**
   - Invalid credentials
   - Required field validation

4. **Token & Session Management**
   - Token persistence in sessionStorage
   - Unauthenticated redirects

5. **Role-based Access**
   - Correct pages shown based on role/permissions

### Custom Commands

Located in `cypress/support/commands.ts`:

- `cy.loginAs(userType, email, password)` - Login helper
- `cy.shouldBeOnRoute(route)` - Route assertion
- `cy.shouldNotHaveEmployeeTabs()` - Client UI verification
- `cy.shouldHaveEmployeeTabs()` - Employee UI verification

## Test Scenarios Covered

### ✅ Client Scenarios
- [x] Login with valid credentials → redirects to `/client-portal`
- [x] Accessing `/home` → redirects to `/client-portal`
- [x] Accessing `/` → redirects to `/client-portal`
- [x] Cannot access employee pages (`/routing`, `/doctor`, etc.)
- [x] Employee navigation tabs not visible
- [x] Token stored in sessionStorage

### ✅ Employee Scenarios
- [x] Login with valid credentials → redirects to `/home`
- [x] Employee navigation tabs visible
- [x] Can access employee pages (based on permissions)
- [x] Token stored in sessionStorage

### ✅ Error Handling
- [x] Invalid credentials show error
- [x] Unauthenticated access redirects to login

## Continuous Integration

### GitHub Actions Example

```yaml
name: E2E Tests

on: [push, pull_request]

jobs:
  cypress-run:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm ci
      - run: npm run build
      - run: npm run preview &
      - run: npm run test:e2e
        env:
          CLIENT_EMAIL: ${{ secrets.TEST_CLIENT_EMAIL }}
          CLIENT_PASSWORD: ${{ secrets.TEST_CLIENT_PASSWORD }}
          EMPLOYEE_EMAIL: ${{ secrets.TEST_EMPLOYEE_EMAIL }}
          EMPLOYEE_PASSWORD: ${{ secrets.TEST_EMPLOYEE_PASSWORD }}
```

## Monitoring with Cypress (Synthetic Monitoring)

Cypress can be used for **synthetic monitoring** by running tests on a schedule:

### Using Cypress Cloud (Paid)

1. Sign up for [Cypress Cloud](https://www.cypress.io/cloud)
2. Connect your project
3. Set up scheduled test runs
4. Get alerts when tests fail

### Using GitHub Actions Scheduled Workflows

```yaml
name: Scheduled E2E Health Checks

on:
  schedule:
    - cron: '*/15 * * * *'  # Every 15 minutes

jobs:
  health-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - run: npm ci
      - run: npm run build
      - run: npm run preview &
      - run: npm run test:e2e
        env:
          CLIENT_EMAIL: ${{ secrets.TEST_CLIENT_EMAIL }}
          CLIENT_PASSWORD: ${{ secrets.TEST_CLIENT_PASSWORD }}
          EMPLOYEE_EMAIL: ${{ secrets.TEST_EMPLOYEE_EMAIL }}
          EMPLOYEE_PASSWORD: ${{ secrets.TEST_EMPLOYEE_PASSWORD }}
      - name: Notify on failure
        if: failure()
        run: |
          # Add notification logic (Slack, email, etc.)
```

### Alternative: External Monitoring Services

For production monitoring, consider:
- **Checkly** - Synthetic monitoring with Cypress
- **Pingdom** - Uptime monitoring
- **DataDog** - Full APM with synthetic tests
- **New Relic** - Application performance monitoring

## Debugging Tests

### View Test Run Video

After a test run, videos are saved to `cypress/videos/` (if `video: true` in config).

### View Screenshots

Screenshots on failure are saved to `cypress/screenshots/`.

### Debug Mode

1. Open Cypress in interactive mode: `npm run test:e2e:open`
2. Click on a test to run it
3. Use `.pause()` in test code to debug:
   ```typescript
   cy.get('input[type="email"]').type(email).pause();
   ```

### Browser Console

When running in interactive mode, you can open DevTools to see:
- Network requests
- Console logs
- Application state

## Best Practices

1. **Use Test Accounts**: Always use dedicated test accounts, never production
2. **Clean State**: Tests use `beforeEach` to clear session storage
3. **Wait for Elements**: Tests use appropriate timeouts for async operations
4. **Environment-Specific**: Different credentials for dev/staging/prod
5. **Regular Runs**: Run tests in CI/CD on every commit
6. **Monitor Flakiness**: Track test stability over time

## Troubleshooting

### Tests Fail with "Cannot connect to baseUrl"

- Ensure dev server is running: `npm run dev`
- Check `cypress.config.ts` baseUrl matches your server
- Verify port 5173 is available

### Login Fails

- Verify test credentials in `cypress.env.json`
- Check that test accounts exist and are active
- Ensure backend API is accessible from test environment

### Redirects Not Working

- Increase timeout: `cy.url({ timeout: 10000 })`
- Check network tab for failed requests
- Verify role data in JWT token

### Element Not Found

- Use `cy.get()` with appropriate selectors
- Wait for elements: `cy.get(...).should('be.visible')`
- Check if element is conditionally rendered based on auth state

## Next Steps

1. **Add More Test Coverage**:
   - Password reset flow
   - Session expiration
   - Permission-specific page access
   - Multi-role users

2. **Performance Testing**:
   - Measure login latency
   - Page load times
   - Navigation performance

3. **Visual Regression**:
   - Use Cypress Visual Testing (screenshot comparison)
   - Catch UI regressions

4. **API Mocking**:
   - Mock backend responses for faster tests
   - Test error scenarios without affecting backend


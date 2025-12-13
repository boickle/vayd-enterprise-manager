# Test Credentials Management

## Overview

Test credentials are **never committed to git**. This document explains how to securely manage test user credentials for Cypress E2E tests.

## Recommended Approaches

### ✅ Option 1: Local `cypress.env.json` File (Recommended for Development)

**Best for:** Local development, team members

1. Copy the example file:
   ```bash
   cp cypress.env.example.json cypress.env.json
   ```

2. Fill in your test credentials:
   ```json
   {
     "CLIENT_EMAIL": "test-client@yourdomain.com",
     "CLIENT_PASSWORD": "actual-test-password",
     "EMPLOYEE_EMAIL": "test-employee@yourdomain.com",
     "EMPLOYEE_PASSWORD": "actual-test-password"
   }
   ```

3. The file is automatically gitignored (see `.gitignore`)

**Pros:**
- Simple and fast
- Works immediately
- No additional setup needed

**Cons:**
- Each team member needs to create their own file
- Credentials need to be shared securely outside git

### ✅ Option 2: Environment Variables (Recommended for CI/CD)

**Best for:** CI/CD pipelines, automated testing

Set environment variables in your CI/CD system:

```bash
export CYPRESS_CLIENT_EMAIL="test-client@yourdomain.com"
export CYPRESS_CLIENT_PASSWORD="test-password"
export CYPRESS_EMPLOYEE_EMAIL="test-employee@yourdomain.com"
export CYPRESS_EMPLOYEE_PASSWORD="test-password"
```

Then run tests:
```bash
npm run test:e2e
```

**GitHub Actions Example:**
```yaml
env:
  CYPRESS_CLIENT_EMAIL: ${{ secrets.TEST_CLIENT_EMAIL }}
  CYPRESS_CLIENT_PASSWORD: ${{ secrets.TEST_CLIENT_PASSWORD }}
  CYPRESS_EMPLOYEE_EMAIL: ${{ secrets.TEST_EMPLOYEE_EMAIL }}
  CYPRESS_EMPLOYEE_PASSWORD: ${{ secrets.TEST_EMPLOYEE_PASSWORD }}
```

**Pros:**
- Secure (never in code)
- Works great in CI/CD
- No local files needed

**Cons:**
- Need to set up in each CI/CD system
- Harder for local development (unless using `.env.local`)

### ✅ Option 3: Hybrid Approach (Best of Both Worlds)

Use `cypress.env.json` for local development, environment variables for CI/CD.

Cypress will automatically prioritize:
1. Environment variables (`CYPRESS_*`)
2. `cypress.env.json` file
3. Default values in config

### ✅ Option 4: Secure Credential Sharing (For Teams)

**Option A: Password Manager**
- Store test credentials in 1Password, LastPass, or similar
- Team members copy to their local `cypress.env.json`

**Option B: Encrypted File (Advanced)**
- Use `git-crypt` or `sops` to encrypt `cypress.env.json`
- Only team members with keys can decrypt

**Option C: Secrets Management Service**
- Use AWS Secrets Manager, HashiCorp Vault, etc.
- Write a small script to fetch and populate `cypress.env.json`

## Creating Test Users

### Recommended Approach

1. **Create dedicated test accounts** in your backend system
   - Email: `cypress-test-client@yourdomain.com`
   - Email: `cypress-test-employee@yourdomain.com`
   - Use strong, unique passwords
   - Mark them clearly as test accounts (e.g., in name field: "CYPRESS TEST")

2. **Use a seed script or admin UI** to create these users
   - Don't rely on manual creation
   - Document how to recreate them

3. **Keep test accounts separate from dev/staging users**
   - Reduces risk of affecting real data
   - Makes it clear they're for testing only

4. **Consider test account cleanup**
   - Reset test accounts periodically
   - Or use disposable accounts that can be recreated

### Test User Requirements

**Client Test User:**
- Must have role: `["client"]` or `role: "client"`
- Should have appropriate client data (if needed for tests)
- Email format: Something identifiable (e.g., `cypress-client-test@yourdomain.com`)

**Employee Test User:**
- Must have role: `["employee"]`, `["admin"]`, or appropriate employee role
- Should have permissions needed for tested pages
- Email format: Something identifiable (e.g., `cypress-employee-test@yourdomain.com`)

## Security Best Practices

1. ✅ **Never commit credentials** - Already handled via `.gitignore`
2. ✅ **Use separate test accounts** - Never use production credentials
3. ✅ **Rotate passwords periodically** - Especially if shared
4. ✅ **Use strong passwords** - Even for test accounts
5. ✅ **Limit test account permissions** - Only grant what's needed for tests
6. ✅ **Monitor test account usage** - Alert on unusual activity
7. ✅ **Document who has access** - Keep track of team members with credentials

## Quick Setup Script

Create a helper script (optional) to guide setup:

```bash
#!/bin/bash
# scripts/setup-cypress-env.sh

if [ ! -f "cypress.env.json" ]; then
  echo "Creating cypress.env.json from example..."
  cp cypress.env.example.json cypress.env.json
  echo "✅ Created cypress.env.json"
  echo "⚠️  Please fill in your test credentials in cypress.env.json"
else
  echo "✅ cypress.env.json already exists"
fi
```

Add to `package.json`:
```json
{
  "scripts": {
    "test:setup": "cp cypress.env.example.json cypress.env.json || true"
  }
}
```

## Troubleshooting

### "Credentials not found" error

1. Check that `cypress.env.json` exists
2. Verify it's properly formatted JSON
3. Check environment variables if using CI/CD

### "Login failed" in tests

1. Verify test user accounts exist in your backend
2. Check credentials are correct
3. Ensure test users are active/not locked
4. Verify backend is accessible from test environment

### Sharing credentials with team

**Secure methods:**
- Password manager (recommended)
- Encrypted Slack message (temporary)
- In-person or secure chat (for initial setup)
- Internal wiki/documentation (if access-controlled)

**Never:**
- Email in plain text
- Commit to git (even in private repos)
- Share in public channels

## CI/CD Setup

### GitHub Actions

Add secrets in repository settings:
- `TEST_CLIENT_EMAIL`
- `TEST_CLIENT_PASSWORD`
- `TEST_EMPLOYEE_EMAIL`
- `TEST_EMPLOYEE_PASSWORD`

Then in workflow:
```yaml
- name: Run E2E tests
  env:
    CYPRESS_CLIENT_EMAIL: ${{ secrets.TEST_CLIENT_EMAIL }}
    CYPRESS_CLIENT_PASSWORD: ${{ secrets.TEST_CLIENT_PASSWORD }}
    CYPRESS_EMPLOYEE_EMAIL: ${{ secrets.TEST_EMPLOYEE_EMAIL }}
    CYPRESS_EMPLOYEE_PASSWORD: ${{ secrets.TEST_EMPLOYEE_PASSWORD }}
  run: npm run test:e2e
```

### Other CI/CD Systems

Similar pattern - use each platform's secrets management:
- **CircleCI**: Project environment variables
- **GitLab CI**: CI/CD variables (masked)
- **Jenkins**: Credentials plugin
- **Azure DevOps**: Variable groups (linked to Key Vault)

## Next Steps

1. Create test user accounts in your backend
2. Choose your preferred method (we recommend Option 1 for local, Option 2 for CI)
3. Set up `cypress.env.json` or environment variables
4. Share credentials securely with team members
5. Document where test users are created/managed


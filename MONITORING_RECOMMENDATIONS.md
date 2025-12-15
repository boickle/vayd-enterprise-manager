# Login & Routing Monitoring Recommendations

## Overview
This document outlines recommendations for monitoring that login works correctly for both clients and employees, and that the correct pages display based on user roles.

## Key Monitoring Points

### 1. **Login API Endpoint Monitoring**

**Endpoint**: `POST /auth/login`

**What to Monitor:**
- Response status codes (200, 401, 400, 500)
- Response time/latency
- Token presence in response
- User role data in response (`user.role` or `user.roles`)
- Password reset flags (`requiresPasswordReset`, `resetPasswordCode`)

**Expected Behavior:**
- **Clients**: Response should include `role: ["client"]` or `roles: ["client"]`
- **Employees**: Response should include roles like `["employee"]`, `["admin"]`, `["superadmin"]`, etc.
- All successful logins should return a valid JWT token

**Alert Thresholds:**
- Error rate > 1% over 5 minutes
- P95 latency > 2 seconds
- Missing token in 200 responses

---

### 2. **JWT Token Decoding & Role Extraction**

**Location**: `src/auth/AuthProvider.tsx` (lines 57-87)

**What to Monitor:**
- Token parsing success rate
- Role extraction from JWT `role` claim
- Client ID extraction from various claims (`clientId`, `client_id`, `client.id`, `userId`, `user_id`, `sub`)

**Expected Behavior:**
- All valid tokens should decode successfully
- Role should be extracted as array (even if single value)
- Clients should have `role.includes("client")` === true
- Employees should have `role.includes("client")` === false

**Alert Thresholds:**
- Token decode failure rate > 0.1%
- Missing role in valid tokens

---

### 3. **Navigation & Routing Logic**

**Location**: `src/pages/Login.tsx` (lines 36-56) and `src/App.tsx` (lines 78-84)

**What to Monitor:**
- Post-login redirect destinations
- Page access attempts (unauthorized vs authorized)

**Expected Behavior:**
- **Clients**: Always redirected to `/client-portal` after login
- **Employees**: Redirected to `/home` or their originally intended page (`from`)
- Clients accessing `/home` or `/` should be automatically redirected to `/client-portal`
- Employees accessing `/client-portal` should see it (if allowed) or be redirected appropriately

**Client Flow:**
```
Login → Check role → If client → Navigate to /client-portal
```

**Employee Flow:**
```
Login → Check role → If employee → Navigate to /home or original destination
```

**Alert Thresholds:**
- Clients landing on `/home` or employee-only pages > 1% of logins
- Employees unable to access `/home` after login > 1% of logins
- 404 errors on `/client-portal` or `/home` for authenticated users

---

### 4. **Protected Route Access Control**

**Location**: `src/auth/ProtectedRoute.tsx` and `src/App.tsx` (lines 192-209)

**What to Monitor:**
- Unauthorized access attempts (redirects from ProtectedRoute)
- Page visibility based on roles

**Expected Behavior:**
- **Clients**: 
  - ✅ Can access `/client-portal` and subroutes (`/client-portal/membership-signup`, etc.)
  - ❌ Cannot access `/home` or any employee pages
  - ❌ Should not see employee navigation tabs
  
- **Employees**: 
  - ✅ Can access `/home` and role-appropriate pages based on `getAccessiblePages()`
  - ✅ Navigation tabs visible
  - ❌ Should not see client portal as default view

**Page Access Matrix:**

| Page | Client | Employee | Admin | Superadmin |
|------|--------|----------|-------|------------|
| `/client-portal` | ✅ | ❌ | ❌ | ❌ |
| `/home` | ❌ (redirects) | ✅ | ✅ | ✅ |
| `/routing` | ❌ | ✅* | ✅* | ✅ |
| `/doctor` | ❌ | ✅* | ✅* | ✅ |
| `/users/create` | ❌ | ❌ | ❌ | ✅ |
| `/analytics/*` | ❌ | ❌ | ✅* | ✅ |
| `/audit` | ❌ | ❌ | ❌ | ✅ |

\* Requires specific permissions (`canSeeRouting`, `canSeeDoctorDay`, etc.)

**Alert Thresholds:**
- Clients accessing employee pages > 0.5% of client logins
- Employees seeing client portal as default > 0.5% of employee logins
- Unauthorized redirects increasing > 10% week-over-week

---

### 5. **Session & Token Storage**

**Location**: `src/auth/AuthProvider.tsx` (sessionStorage usage)

**What to Monitor:**
- Token persistence in sessionStorage
- Email persistence
- Client ID persistence
- Token expiration handling

**Expected Behavior:**
- Token stored as `vayd_token` in sessionStorage
- Email stored as `vayd_email`
- Client ID stored as `vayd_clientId` (if applicable)
- Token expiration triggers logout before expiry (10s safety margin)

**Alert Thresholds:**
- Token storage failures
- Premature token expiration
- Token not found after successful login

---

## Implementation Recommendations

### A. **Frontend Logging/Telemetry**

Add logging at critical points:

```typescript
// In Login.tsx onSubmit function (after login success)
console.log('[AUTH] Login success', {
  email,
  roles: roles,
  isClient,
  redirectTo: isClient ? '/client-portal' : fallback,
  timestamp: new Date().toISOString()
});

// In App.tsx useEffect (role-based redirect)
console.log('[AUTH] Role-based redirect check', {
  isClient,
  currentPath: location.pathname,
  redirecting: isClient && (location.pathname === '/' || location.pathname === '/home'),
  timestamp: new Date().toISOString()
});

// In ProtectedRoute component
console.log('[AUTH] Protected route access check', {
  path: location.pathname,
  hasToken: !!token,
  roles: roles,
  allowed: !!(token && (!allowRoles || hasAny(allowRoles)) && (!disallowRoles || !hasAny(disallowRoles))),
  timestamp: new Date().toISOString()
});
```

### B. **Backend API Monitoring**

Monitor the `/auth/login` endpoint:
- Log all login attempts with role information
- Track response structure (ensure `role` field is always present)
- Monitor token generation success rate

### C. **Browser Console Monitoring**

For development/debugging, check browser console for:
- Authentication errors
- Navigation redirects
- Token decode failures
- Protected route blocks

### D. **E2E Test Scenarios**

Recommended test cases:

1. **Client Login Flow:**
   ```gherkin
   Given a user with role "client"
   When they log in successfully
   Then they should be redirected to /client-portal
   And the navbar should not show employee tabs
   And accessing /home should redirect to /client-portal
   ```

2. **Employee Login Flow:**
   ```gherkin
   Given a user with role "employee"
   When they log in successfully
   Then they should be redirected to /home
   And the navbar should show employee tabs
   And they should see pages based on their permissions
   ```

3. **Role-based Page Access:**
   ```gherkin
   Given an authenticated client
   When they try to access /home
   Then they should be redirected to /client-portal
   
   Given an authenticated client
   When they try to access /routing
   Then they should see "Not found" or be redirected
   
   Given an authenticated employee
   When they try to access /client-portal
   Then they should see employee interface (or appropriate redirect)
   ```

### E. **Error Tracking**

Use error tracking service (e.g., Sentry, LogRocket) to monitor:
- Login failures with role information
- Navigation errors
- Token decode failures
- Protected route access violations

### G. **E2E Testing with Cypress**

**Cypress is an excellent choice for monitoring login functionality!**

**What Cypress Provides:**
- ✅ E2E testing of complete login flows
- ✅ Verification of correct page display after login
- ✅ Role-based routing validation
- ✅ Can be used for synthetic monitoring (scheduled runs)
- ✅ Great developer experience with test runner

**Setup**: See `CYPRESS_SETUP.md` for complete setup instructions.

**Key Test Scenarios:**
- Client login → `/client-portal` redirect
- Employee login → `/home` redirect  
- Role-based page access control
- Token persistence
- Navigation correctness

**For Production Monitoring:**
- Run Cypress tests on a schedule (every 15-30 min)
- Alert when tests fail
- Can use Cypress Cloud, GitHub Actions, or external services (Checkly, etc.)

### F. **Performance Monitoring**

Monitor:
- Login API response time
- Token decode time
- Page navigation time after login
- Initial page load time based on role

---

## Quick Health Check Script

Create a simple monitoring script that can be run periodically:

```javascript
// Check login health
async function checkLoginHealth() {
  // Test client login
  const clientResult = await testLogin('client@example.com', 'password');
  assert(clientResult.role.includes('client'));
  assert(clientResult.redirectUrl === '/client-portal');
  
  // Test employee login
  const employeeResult = await testLogin('employee@example.com', 'password');
  assert(!employeeResult.role.includes('client'));
  assert(employeeResult.redirectUrl === '/home');
  
  // Test token decode
  const decoded = decodeJWT(clientResult.token);
  assert(decoded.role.includes('client'));
}
```

---

## Dashboard Metrics to Track

1. **Login Success Rate by Role**
   - Client login success %
   - Employee login success %
   - Overall login success %

2. **Post-Login Navigation**
   - Clients reaching `/client-portal` %
   - Employees reaching `/home` %
   - Incorrect redirects count

3. **Access Control Violations**
   - Clients attempting employee pages
   - Unauthorized page access attempts
   - Protected route blocks

4. **Token Health**
   - Token decode success rate
   - Token expiration handling
   - Session storage reliability

---

## Alert Configuration

### Critical Alerts (Immediate Action Required)
- Login API error rate > 5%
- All clients unable to access `/client-portal`
- All employees unable to access `/home`
- Token decode failure rate > 1%

### Warning Alerts (Investigate Soon)
- Login API error rate > 1%
- Incorrect redirects > 1% of logins
- Unauthorized access attempts increasing
- Token storage failures

### Info Alerts (Monitor Trends)
- Login latency p95 > 2s
- Navigation time > 1s
- Role extraction anomalies

---

## Code Locations Reference

- **Login Logic**: `src/pages/Login.tsx` (lines 17-62)
- **Auth Provider**: `src/auth/AuthProvider.tsx` (lines 33-224)
- **Protected Routes**: `src/auth/ProtectedRoute.tsx`
- **App Routing**: `src/App.tsx` (lines 59-224)
- **Page Access Control**: `src/app-pages.tsx` (lines 32-110)


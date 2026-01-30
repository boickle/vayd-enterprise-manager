# Testing Refresh Token Functionality

This guide provides multiple methods to test that the refresh token system is working correctly.

## Quick Test Methods

### Method 1: Browser DevTools Network Monitoring (Recommended)

1. **Open Browser DevTools**
   - Press `F12` or `Cmd+Option+I` (Mac) / `Ctrl+Shift+I` (Windows/Linux)
   - Go to the **Network** tab

2. **Login to the application**
   - Verify you see tokens stored in localStorage:
     - `accessToken` (JWT token)
     - `refreshToken` (long string)

3. **Monitor for refresh calls**
   - Keep the Network tab open
   - Filter by "refresh" or look for requests to `/auth/refresh`
   - When the access token expires (15 minutes), you should see:
     - A `POST /auth/refresh` request
     - The original failed request retried with the new token

4. **Check Console**
   - Open the **Console** tab
   - Look for log messages:
     - `[Token Refresh] Attempting to refresh access token...`
     - `[Token Refresh] ✅ Successfully refreshed tokens`
     - `[HTTP Interceptor] 401 detected, attempting token refresh...`

### Method 2: Manually Expire Access Token (Fastest Test)

This method lets you test immediately without waiting 15 minutes:

1. **Login to the application**

2. **Open Browser Console** (F12 → Console tab)

3. **Get the current access token:**
   ```javascript
   const token = localStorage.getItem('accessToken');
   console.log('Current token:', token);
   ```

4. **Decode and modify the token to expire it:**
   ```javascript
   // Decode the JWT (just for viewing)
   const parts = token.split('.');
   const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
   console.log('Token expires at:', new Date(payload.exp * 1000));
   
   // Create an expired token (set exp to past time)
   const expiredPayload = { ...payload, exp: Math.floor(Date.now() / 1000) - 60 }; // Expired 1 minute ago
   const expiredToken = parts[0] + '.' + btoa(JSON.stringify(expiredPayload)).replace(/\+/g, '-').replace(/\//g, '_') + '.' + parts[2];
   
   // Note: This won't work because the signature will be invalid
   // Instead, just replace with an invalid/expired token format
   ```

5. **Better approach - Replace with an expired token:**
   ```javascript
   // Get an expired JWT (you can generate one or use a test expired token)
   // Or simply corrupt the token to force a 401
   localStorage.setItem('accessToken', 'expired.token.here');
   ```

6. **Make an API request:**
   - Navigate to any page that makes an API call
   - Or trigger any action that calls the API
   - Watch the Network tab for:
     - Original request returns 401
     - Automatic `POST /auth/refresh` call
     - Original request retried successfully

### Method 3: Use Browser Console Test Function

Paste this into the browser console to test refresh functionality:

```javascript
// Test refresh token functionality
async function testTokenRefresh() {
  console.log('🧪 Testing Token Refresh...\n');
  
  // Check current tokens
  const accessToken = localStorage.getItem('accessToken');
  const refreshToken = localStorage.getItem('refreshToken');
  
  console.log('Current Access Token:', accessToken ? '✅ Present' : '❌ Missing');
  console.log('Current Refresh Token:', refreshToken ? '✅ Present' : '❌ Missing');
  
  if (!refreshToken) {
    console.error('❌ No refresh token found. Please login first.');
    return;
  }
  
  // Get the base URL
  const baseURL = window.location.origin.includes('localhost') 
    ? 'http://localhost:3000' 
    : window.location.origin;
  
  try {
    console.log('\n📡 Calling /auth/refresh endpoint...');
    const response = await fetch(`${baseURL}/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ refreshToken }),
    });
    
    if (response.ok) {
      const data = await response.json();
      console.log('✅ Refresh successful!');
      console.log('New Access Token:', data.accessToken ? '✅ Received' : '❌ Missing');
      console.log('New Refresh Token:', data.refreshToken ? '✅ Received' : '❌ Missing');
      
      // Update tokens
      if (data.accessToken && data.refreshToken) {
        localStorage.setItem('accessToken', data.accessToken);
        localStorage.setItem('refreshToken', data.refreshToken);
        console.log('\n✅ Tokens updated in localStorage');
      }
    } else {
      const error = await response.json().catch(() => ({ message: 'Unknown error' }));
      console.error('❌ Refresh failed:', response.status, error);
    }
  } catch (error) {
    console.error('❌ Network error:', error);
  }
}

// Run the test
testTokenRefresh();
```

### Method 4: Simulate 401 Response

1. **Open Browser Console**

2. **Intercept and modify a request to return 401:**
   ```javascript
   // This is for testing only - intercept fetch/axios
   const originalFetch = window.fetch;
   let callCount = 0;
   
   window.fetch = function(...args) {
     const [url, options] = args;
     
     // Make the first call to a protected endpoint return 401
     if (url.includes('/api/') && callCount === 0) {
       callCount++;
       return Promise.resolve(new Response(
         JSON.stringify({ error: 'Unauthorized' }),
         { status: 401, statusText: 'Unauthorized' }
       ));
     }
     
     return originalFetch.apply(this, args);
   };
   ```

3. **Trigger an API call** and watch for automatic refresh

### Method 5: Monitor localStorage Changes

1. **Open DevTools → Application tab → Local Storage**

2. **Watch for token updates:**
   - `accessToken` should change when refreshed
   - `refreshToken` should also change (token rotation)

3. **You can also add a watcher in console:**
   ```javascript
   // Watch for localStorage changes
   const originalSetItem = localStorage.setItem;
   localStorage.setItem = function(key, value) {
     if (key === 'accessToken' || key === 'refreshToken') {
       console.log(`🔄 Token updated: ${key}`, value.substring(0, 20) + '...');
     }
     return originalSetItem.apply(this, arguments);
   };
   ```

## Expected Behavior

### ✅ Successful Refresh Flow

1. **Access token expires** (after 15 minutes or manually expired)
2. **API request returns 401**
3. **Automatic refresh triggered:**
   - Console: `[HTTP Interceptor] 401 detected, attempting token refresh...`
   - Network: `POST /auth/refresh` request
4. **New tokens received and stored**
5. **Original request retried with new token**
6. **Request succeeds**

### ❌ Failed Refresh Scenarios

1. **Refresh token expired (60 days):**
   - Refresh call fails
   - User is logged out automatically
   - Redirected to login page

2. **Refresh token revoked:**
   - Refresh call fails
   - User is logged out automatically
   - Redirected to login page

3. **Network error during refresh:**
   - Refresh fails
   - User is logged out automatically
   - Redirected to login page

## Verification Checklist

- [ ] Login stores both `accessToken` and `refreshToken` in localStorage
- [ ] Access token is used in API request headers
- [ ] 401 responses trigger automatic token refresh
- [ ] Refresh endpoint is called with refresh token
- [ ] New tokens are stored after refresh
- [ ] Original request is retried after refresh
- [ ] Multiple concurrent requests are queued during refresh
- [ ] Failed refresh logs out user and redirects to login
- [ ] Logout endpoint is called when user logs out
- [ ] Tokens are cleared on logout

## Debugging Tips

1. **Check Console Logs:**
   - Look for `[Token Refresh]` and `[HTTP Interceptor]` messages
   - These show the refresh flow step-by-step

2. **Check Network Tab:**
   - Filter by "refresh" to see refresh calls
   - Check request/response payloads
   - Verify status codes

3. **Check localStorage:**
   - Verify tokens are present
   - Check if tokens are being updated
   - Ensure old tokens are removed

4. **Check Token Expiration:**
   ```javascript
   // Decode and check token expiration
   const token = localStorage.getItem('accessToken');
   if (token) {
     const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
     const expiresAt = new Date(payload.exp * 1000);
     const now = new Date();
     console.log('Token expires:', expiresAt);
     console.log('Time until expiry:', Math.round((expiresAt - now) / 1000 / 60), 'minutes');
     console.log('Is expired:', expiresAt < now);
   }
   ```

## Removing Debug Logs

After testing, you can remove the console.log statements from `src/api/http.ts` if you want cleaner production logs. The logs are helpful for debugging but not necessary for production.

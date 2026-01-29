// src/api/http.ts
import axios, { AxiosError, AxiosHeaders, AxiosRequestHeaders, InternalAxiosRequestConfig } from 'axios';

export const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';
const baseURL = apiBaseUrl;

// Initialize token from localStorage on module load
// Support both old token format and new accessToken format for migration
let token: string | null = (() => {
  try {
    return localStorage.getItem('accessToken') || localStorage.getItem('vayd_token');
  } catch {
    return null;
  }
})();
let logoutHandler: (() => void) | null = null;
let logoutTimerId: number | null = null;
let refreshPromise: Promise<string | null> | null = null;
let refreshLock = false; // Synchronous lock to prevent race conditions
let failedQueue: Array<{
  resolve: (value?: any) => void;
  reject: (error?: any) => void;
  config: InternalAxiosRequestConfig;
}> = [];

function decodeJwtExp(t: string): number | null {
  try {
    const [, payloadB64] = t.split('.');
    if (!payloadB64) return null;
    const json = atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/'));
    const payload = JSON.parse(json);
    return typeof payload?.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

function clearAutoLogout() {
  if (logoutTimerId != null) {
    console.log('[Token Refresh] ⏰ Clearing existing auto-logout timer');
    window.clearTimeout(logoutTimerId);
    logoutTimerId = null;
  }
}

async function attemptTokenRefresh(): Promise<boolean> {
  console.log('[Token Refresh] 🔄 attemptTokenRefresh() called', new Error().stack?.split('\n')[2]?.trim());
  
  // Check if a refresh is already in progress - if so, wait for it instead of starting a new one
  if (refreshPromise) {
    console.log('[Token Refresh] 🔄 Refresh already in progress, waiting for existing refresh');
    try {
      const result = await refreshPromise;
      if (result) {
        console.log('[Token Refresh] ✅ Existing refresh succeeded, rescheduling timer');
        token = result;
        scheduleAutoLogout(result);
        return true;
      } else {
        console.warn('[Token Refresh] ❌ Existing refresh failed');
        // Refresh failed, but logout was already handled by the refresh function
        return false;
      }
    } catch (error) {
      console.error('[Token Refresh] ❌ Error waiting for existing refresh:', error);
      return false;
    }
  }
  
  const refreshToken = localStorage.getItem('refreshToken');
  if (!refreshToken) {
    console.warn('[Token Refresh] ❌ No refresh token available, logging out');
    // No refresh token available, logout
    forceLogout();
    return false;
  }

  try {
    console.log('[Token Refresh] 🔄 Calling refreshAccessToken() from attemptTokenRefresh');
    // Try to refresh - refreshAccessToken handles deduplication
    // If it fails, refreshAccessToken will handle logout
    const newAccessToken = await refreshAccessToken(true);
    if (newAccessToken) {
      console.log('[Token Refresh] ✅ Proactive refresh succeeded, rescheduling timer');
      // Token refreshed successfully, update the token and reschedule
      token = newAccessToken;
      scheduleAutoLogout(newAccessToken);
      return true;
    }
    console.warn('[Token Refresh] ❌ Proactive refresh failed, logout was already called');
    // If we get here, refresh failed and logout was already called
    return false;
  } catch (error) {
    console.error('[Token Refresh] ❌ Proactive token refresh exception:', error);
    // If refresh failed, logout
    forceLogout();
    return false;
  }
}

function scheduleAutoLogout(t: string) {
  clearAutoLogout();
  const exp = decodeJwtExp(t);
  if (!exp) {
    console.log('[Token Refresh] ⏰ scheduleAutoLogout: No exp claim in token, skipping timer');
    return;
  }
  const skewMs = 10_000;
  const now = Date.now();
  const expMs = exp * 1000;
  const fireInMs = Math.max(0, expMs - now - skewMs);
  const expiresAt = new Date(exp * 1000);
  const timeUntilExpiry = expMs - now;
  console.log(`[Token Refresh] ⏰ scheduleAutoLogout: Token expires at ${expiresAt.toISOString()}, time until expiry: ${Math.round(timeUntilExpiry / 1000)}s, timer set for ${fireInMs}ms (${Math.round(fireInMs / 1000)}s)`);
  
  if (fireInMs === 0) {
    console.warn('[Token Refresh] ⏰ Token expired or about to expire (fireInMs=0), attempting refresh immediately');
    console.warn('[Token Refresh] ⏰ Current time:', new Date(now).toISOString());
    console.warn('[Token Refresh] ⏰ Token expiry:', expiresAt.toISOString());
    console.warn('[Token Refresh] ⏰ Time until expiry (ms):', timeUntilExpiry);
    // Token is expired or about to expire, try to refresh first
    // attemptTokenRefresh will handle logout if refresh fails
    attemptTokenRefresh();
    return;
  }
  console.log(`[Token Refresh] ⏰ Setting timer ID: ${logoutTimerId}`);
  logoutTimerId = window.setTimeout(async () => {
    console.log('[Token Refresh] ⏰ Auto-logout timer fired, attempting refresh before logout');
    // Try to refresh the token before logging out
    // attemptTokenRefresh will handle logout if refresh fails
    await attemptTokenRefresh();
  }, fireInMs) as unknown as number;
  console.log(`[Token Refresh] ⏰ Timer set with ID: ${logoutTimerId}`);
}

export function setToken(t: string | null) {
  const caller = new Error().stack?.split('\n')[2]?.trim() || 'unknown';
  console.log(`[Token Refresh] 🔧 setToken() called from: ${caller}, token: ${t ? 'has token' : 'null'}`);
  token = t;
  clearAutoLogout();
  if (t) {
    console.log('[Token Refresh] 🔧 Scheduling auto-logout for new token');
    scheduleAutoLogout(t);
  } else {
    console.log('[Token Refresh] 🔧 Token is null, not scheduling auto-logout');
  }
}
export function getToken() {
  // Always get the latest token from localStorage
  try {
    return localStorage.getItem('accessToken') || localStorage.getItem('vayd_token');
  } catch {
    return token;
  }
}

export function setLogoutHandler(fn: () => void) {
  logoutHandler = fn;
}
export function forceLogout() {
  const stack = new Error().stack;
  const caller = stack?.split('\n')[2]?.trim() || 'unknown';
  const fullStack = stack?.split('\n').slice(0, 10).join('\n') || 'no stack';
  console.warn('[Token Refresh] 🚪 forceLogout() called from:', caller);
  console.warn('[Token Refresh] 🚪 Full call stack:', fullStack);
  clearAutoLogout();
  token = null;
  try {
    const hadAccessToken = !!localStorage.getItem('accessToken');
    const hadRefreshToken = !!localStorage.getItem('refreshToken');
    console.log('[Token Refresh] 🚪 Before logout - hadAccessToken:', hadAccessToken, 'hadRefreshToken:', hadRefreshToken);
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('vayd_token'); // Remove old token for migration
    localStorage.setItem('logout_broadcast', String(Date.now()));
    console.log('[Token Refresh] 🚪 Tokens cleared from localStorage, logout_broadcast set');
  } catch (e) {
    console.error('[Token Refresh] 🚪 Error clearing localStorage:', e);
  }
  console.log('[Token Refresh] 🚪 Calling logoutHandler');
  logoutHandler?.();
}

// Refresh access token using refresh token (internal implementation)
async function _performTokenRefresh(shouldLogoutOnFailure: boolean = true): Promise<string | null> {
  const refreshToken = localStorage.getItem('refreshToken');
  console.log('[Token Refresh] 🔐 _performTokenRefresh() called, shouldLogoutOnFailure:', shouldLogoutOnFailure);
  
  if (!refreshToken) {
    console.warn('[Token Refresh] 🔐 No refresh token in localStorage');
    if (shouldLogoutOnFailure) {
      console.warn('[Token Refresh] 🔐 Calling forceLogout() because no refresh token');
      forceLogout();
    }
    return null;
  }

  try {
    console.log('[Token Refresh] 🔐 Making POST request to /auth/refresh');
    const response = await axios.post(
      `${baseURL}/auth/refresh`,
      { refreshToken },
      { withCredentials: false }
    );
    console.log('[Token Refresh] 🔐 Refresh response received:', {
      hasAccessToken: !!response.data?.accessToken,
      hasRefreshToken: !!response.data?.refreshToken,
      status: response.status
    });

    if (response.data?.accessToken && response.data?.refreshToken) {
      const { accessToken, refreshToken: newRefreshToken } = response.data;
      
      // Store new tokens
      localStorage.setItem('accessToken', accessToken);
      localStorage.setItem('refreshToken', newRefreshToken);
      // Remove old token format for migration
      localStorage.removeItem('vayd_token');
      
      // Update module-level token
      token = accessToken;
      
      console.log('[Token Refresh] 🔐 ✅ Tokens updated successfully');
      
      // Notify AuthProvider about token update by dispatching a custom event
      // (StorageEvent only fires for cross-tab changes, so we use a custom event)
      try {
        window.dispatchEvent(new StorageEvent('storage', {
          key: 'accessToken',
          newValue: accessToken,
          oldValue: localStorage.getItem('accessToken'),
          storageArea: localStorage,
        }));
      } catch (e) {
        // Fallback: dispatch a custom event if StorageEvent constructor fails
        window.dispatchEvent(new CustomEvent('tokenRefreshed', { detail: { accessToken } }));
      }
      
      return accessToken;
    }
    
    console.warn('[Token Refresh] 🔐 ❌ Response missing accessToken or refreshToken');
    if (shouldLogoutOnFailure) {
      console.warn('[Token Refresh] 🔐 Calling forceLogout() because response missing tokens');
      forceLogout();
    }
    return null;
  } catch (error: any) {
    const status = error?.response?.status;
    const statusText = error?.response?.statusText;
    const errorData = error?.response?.data;
    
    console.error('[Token Refresh] 🔐 ❌ Token refresh request failed:', {
      message: error?.message,
      status,
      statusText,
      data: errorData
    });
    
    // If we get 401, it might mean the refresh token was already used/rotated
    // This can happen if multiple refresh requests were made simultaneously
    // In this case, we should check if a new token was already stored by another request
    if (status === 401) {
      console.warn('[Token Refresh] 🔐 Got 401 on refresh - token may have been rotated by another request');
      const currentAccessToken = localStorage.getItem('accessToken');
      const currentRefreshToken = localStorage.getItem('refreshToken');
      
      // If we still have tokens, another refresh might have succeeded
      if (currentAccessToken && currentRefreshToken) {
        console.log('[Token Refresh] 🔐 Tokens still exist, another refresh may have succeeded');
        // Don't logout - the other refresh succeeded
        return null;
      }
    }
    
    // Refresh failed, clear tokens and logout (only if shouldLogoutOnFailure is true)
    if (shouldLogoutOnFailure) {
      console.warn('[Token Refresh] 🔐 Calling forceLogout() because refresh request failed');
      forceLogout();
    }
    return null;
  }
}

// Refresh access token with deduplication - ensures only one refresh happens at a time
async function refreshAccessToken(shouldLogoutOnFailure: boolean = true): Promise<string | null> {
  const caller = new Error().stack?.split('\n')[2]?.trim() || 'unknown';
  console.log(`[Token Refresh] 🔄 refreshAccessToken() called from: ${caller}, shouldLogoutOnFailure: ${shouldLogoutOnFailure}`);
  console.log(`[Token Refresh] 🔄 Current state: refreshPromise=${!!refreshPromise}, refreshLock=${refreshLock}`);
  
  // First check: if refresh is already in progress, wait for it
  if (refreshPromise) {
    console.log('[Token Refresh] 🔄 Refresh already in progress, waiting for existing promise');
    try {
      const result = await refreshPromise;
      console.log('[Token Refresh] 🔄 Waited for existing refresh, result:', result ? 'success' : 'failed');
      return result;
    } catch (error) {
      console.error('[Token Refresh] 🔄 Error waiting for existing refresh:', error);
      return null;
    }
  }

  // Acquire lock synchronously (this is atomic from the perspective of other synchronous code)
  if (refreshLock) {
    console.log('[Token Refresh] 🔄 Lock is set, waiting for other request to create promise');
    // Another request is creating a refresh promise, wait for it
    // Use a small delay to let the other request set refreshPromise
    await new Promise(resolve => setTimeout(resolve, 0));
    if (refreshPromise) {
      console.log('[Token Refresh] 🔄 Promise was set by other request, waiting for it');
      return await refreshPromise;
    }
    console.warn('[Token Refresh] 🔄 Lock was set but promise not created, proceeding anyway');
  }

  // Set lock
  console.log('[Token Refresh] 🔄 Acquiring lock and creating new refresh promise');
  refreshLock = true;

  try {
    // Double-check: another request might have set refreshPromise while we were waiting
    if (refreshPromise) {
      console.log('[Token Refresh] 🔄 Promise was set while acquiring lock, using it');
      refreshLock = false;
      return await refreshPromise;
    }

    // Create and assign the promise
    console.log('[Token Refresh] 🔄 Creating new refresh promise');
    refreshPromise = _performTokenRefresh(shouldLogoutOnFailure)
      .finally(() => {
        console.log('[Token Refresh] 🔄 Refresh promise completed, clearing promise and lock');
        // Clear both the promise and the lock when done
        refreshPromise = null;
        refreshLock = false;
      });

    // Wait for the refresh to complete
    const result = await refreshPromise;
    console.log('[Token Refresh] 🔄 Refresh completed, result:', result ? 'success' : 'failed');
    return result;
  } catch (error) {
    console.error('[Token Refresh] 🔄 Exception in refreshAccessToken:', error);
    // On error, clear the lock and promise
    refreshLock = false;
    refreshPromise = null;
    return null;
  }
}

// Process queued requests after token refresh
function processQueue(error: any, token: string | null = null) {
  failedQueue.forEach(({ resolve, reject, config }) => {
    if (error) {
      reject(error);
    } else {
      // Retry the original request with new token
      if (config.headers) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      resolve(http(config));
    }
  });
  
  failedQueue = [];
}

try {
  window.addEventListener('storage', (e) => {
    if (e.key === 'logout_broadcast') {
      console.log('[Token Refresh] 📡 logout_broadcast storage event received');
      token = null;
      clearAutoLogout();
      console.log('[Token Refresh] 📡 Calling logoutHandler from storage event');
      logoutHandler?.();
    }
  });
} catch {
  /* noop */
}

export const http = axios.create({ baseURL, withCredentials: false });

http.interceptors.request.use((config) => {
  // Build a typed AxiosHeaders instance from whatever is there
  const headers = AxiosHeaders.from(config.headers || {}) as AxiosHeaders;

  // Get the latest token from localStorage
  const currentToken = getToken();

  // Only attach if not already present (case-insensitive handled by AxiosHeaders)
  if (!headers.has('Authorization') && currentToken) {
    headers.set('Authorization', `Bearer ${currentToken}`);
  }

  config.headers = headers as AxiosRequestHeaders;
  return config;
});

http.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

    // Handle 401 Unauthorized - try to refresh token
    if (error?.response?.status === 401 && originalRequest && !originalRequest._retry) {
      const requestUrl = originalRequest.url || 'unknown';
      console.log(`[HTTP Interceptor] 🚨 401 received for ${requestUrl}, attempting token refresh`);
      originalRequest._retry = true;

      // If we're already refreshing, queue this request and wait for the existing refresh
      if (refreshPromise) {
        console.log(`[HTTP Interceptor] 🔄 Refresh already in progress for ${requestUrl}, waiting for existing promise`);
        return new Promise((resolve, reject) => {
          // Wait for the ongoing refresh to complete
          refreshPromise!
            .then((newAccessToken) => {
              if (newAccessToken) {
                console.log(`[HTTP Interceptor] ✅ Refresh succeeded for ${requestUrl}, retrying request`);
                // Update the authorization header
                if (originalRequest.headers) {
                  originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
                }
                // Retry the original request
                resolve(http(originalRequest));
              } else {
                console.warn(`[HTTP Interceptor] ❌ Refresh failed for ${requestUrl}`);
                // Refresh failed
                reject(new Error('Token refresh failed'));
              }
            })
            .catch((refreshError) => {
              console.error(`[HTTP Interceptor] ❌ Refresh error for ${requestUrl}:`, refreshError);
              reject(refreshError);
            });
        });
      }

      // Start a new refresh operation
      console.log(`[HTTP Interceptor] 🔄 Starting new refresh for ${requestUrl}`);
      try {
        // Always logout on failure when called from 401 interceptor
        const newAccessToken = await refreshAccessToken(true);

        if (newAccessToken) {
          console.log(`[HTTP Interceptor] ✅ Refresh succeeded for ${requestUrl}, retrying request`);
          // Update the authorization header
          if (originalRequest.headers) {
            originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
          }

          // Process any queued requests (from before we implemented promise-based deduplication)
          processQueue(null, newAccessToken);

          // Retry the original request
          return http(originalRequest);
        } else {
          console.warn(`[HTTP Interceptor] ❌ Refresh failed for ${requestUrl}, logging out`);
          // Refresh failed, process queue with error
          processQueue(new Error('Token refresh failed'));
          forceLogout();
          return Promise.reject(error);
        }
      } catch (refreshError) {
        console.error(`[HTTP Interceptor] ❌ Refresh exception for ${requestUrl}:`, refreshError);
        // Refresh failed, process queue with error
        processQueue(refreshError);
        forceLogout();
        return Promise.reject(refreshError);
      }
    }

    // For other errors, just reject
    return Promise.reject(error);
  }
);

// One-off POST with override token (typed headers)
export function postWithToken<T = any>(path: string, data: any, tokenOverride: string) {
  const headers = new AxiosHeaders({ Authorization: `Bearer ${tokenOverride}` });
  return http.post<T>(path, data, { headers });
}

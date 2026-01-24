// src/api/http.ts
import axios, { AxiosError, AxiosHeaders, AxiosRequestHeaders, InternalAxiosRequestConfig } from 'axios';

const baseURL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

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
let isRefreshing = false;
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
    window.clearTimeout(logoutTimerId);
    logoutTimerId = null;
  }
}

function scheduleAutoLogout(t: string) {
  clearAutoLogout();
  const exp = decodeJwtExp(t);
  if (!exp) return;
  const skewMs = 10_000;
  const fireInMs = Math.max(0, exp * 1000 - Date.now() - skewMs);
  if (fireInMs === 0) {
    forceLogout();
    return;
  }
  logoutTimerId = window.setTimeout(forceLogout, fireInMs) as unknown as number;
}

export function setToken(t: string | null) {
  token = t;
  clearAutoLogout();
  if (t) scheduleAutoLogout(t);
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
  clearAutoLogout();
  token = null;
  try {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('vayd_token'); // Remove old token for migration
    localStorage.setItem('logout_broadcast', String(Date.now()));
  } catch {}
  logoutHandler?.();
}

// Refresh access token using refresh token
async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = localStorage.getItem('refreshToken');
  
  if (!refreshToken) {
    return null;
  }

  try {
    const response = await axios.post(
      `${baseURL}/auth/refresh`,
      { refreshToken },
      { withCredentials: false }
    );

    if (response.data?.accessToken && response.data?.refreshToken) {
      const { accessToken, refreshToken: newRefreshToken } = response.data;
      
      // Store new tokens
      localStorage.setItem('accessToken', accessToken);
      localStorage.setItem('refreshToken', newRefreshToken);
      // Remove old token format for migration
      localStorage.removeItem('vayd_token');
      
      // Update module-level token
      token = accessToken;
      
      return accessToken;
    }
    
    return null;
  } catch (error) {
    console.error('Token refresh failed:', error);
    // Refresh failed, clear tokens and logout
    forceLogout();
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
      token = null;
      clearAutoLogout();
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
      // If we're already refreshing, queue this request
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject, config: originalRequest });
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const newAccessToken = await refreshAccessToken();

        if (newAccessToken) {
          // Update the authorization header
          if (originalRequest.headers) {
            originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
          }

          // Process queued requests
          processQueue(null, newAccessToken);

          // Retry the original request
          return http(originalRequest);
        } else {
          // Refresh failed, process queue with error
          processQueue(new Error('Token refresh failed'));
          forceLogout();
          return Promise.reject(error);
        }
      } catch (refreshError) {
        // Refresh failed, process queue with error
        processQueue(refreshError);
        forceLogout();
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
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

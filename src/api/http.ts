// src/api/http.ts
import axios, { AxiosError, AxiosHeaders, AxiosRequestHeaders } from 'axios';

const baseURL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

// Initialize token from localStorage on module load
let token: string | null = (() => {
  try {
    return localStorage.getItem('vayd_token');
  } catch {
    return null;
  }
})();
let logoutHandler: (() => void) | null = null;
let logoutTimerId: number | null = null;

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
  return token;
}

export function setLogoutHandler(fn: () => void) {
  logoutHandler = fn;
}
export function forceLogout() {
  clearAutoLogout();
  token = null;
  try {
    localStorage.setItem('logout_broadcast', String(Date.now()));
  } catch {}
  logoutHandler?.();
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

  // Only attach if not already present (case-insensitive handled by AxiosHeaders)
  if (!headers.has('Authorization') && token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  config.headers = headers as AxiosRequestHeaders;
  return config;
});

http.interceptors.response.use(
  (res) => res,
  (error: AxiosError) => {
    if (error?.response?.status === 401) {
      forceLogout();
    }
    return Promise.reject(error);
  }
);

// One-off POST with override token (typed headers)
export function postWithToken<T = any>(path: string, data: any, tokenOverride: string) {
  const headers = new AxiosHeaders({ Authorization: `Bearer ${tokenOverride}` });
  return http.post<T>(path, data, { headers });
}

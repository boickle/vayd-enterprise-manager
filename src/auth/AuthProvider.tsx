// src/auth/useAuth.tsx
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { http, setToken } from '../api/http';
import { setLogoutHandler } from '../api/http';

const MOCK = import.meta.env.VITE_MOCK_AUTH === '1';

export type LoginResult = {
  token?: string | null;
  user?: {
    id?: number;
    email?: string;
    requiresPasswordReset?: boolean;
    resetPasswordCode?: string | null;
    [k: string]: any;
  } | null;
  resetRequired: boolean;
  resetCode?: string | null;
};

type AuthContextType = {
  token: string | null;
  userEmail: string | null;
  role: string[];
  // ⬅️ now returns a LoginResult instead of void
  login: (email: string, password: string) => Promise<LoginResult>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [tokenState, setTokenState] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem('vayd_token');
    } catch {
      return null;
    }
  });
  const [email, setEmail] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem('vayd_email');
    } catch {
      return null;
    }
  });
  const [role, setRole] = useState<string[]>([]);

  useEffect(() => {
    setToken(tokenState);
    if (tokenState) {
      const payload = decodeJwt(tokenState);
      const roleClaim = payload?.role || [];
      setRole(Array.isArray(roleClaim) ? roleClaim : [String(roleClaim)]);
    } else {
      setRole([]);
    }
  }, [tokenState]);

  useEffect(() => {
    setToken(tokenState);
  }, [tokenState]);

  useEffect(() => {
    if (typeof setLogoutHandler === 'function') {
      setLogoutHandler(() => {
        try {
          sessionStorage.removeItem('vayd_token');
          sessionStorage.removeItem('vayd_email');
        } catch {}
        setTokenState(null);
        setEmail(null);
        setToken(null);
      });
    }
  }, []);

  // -------------------
  // LOGIN (updated)
  // -------------------
  async function login(emailInput: string, password: string): Promise<LoginResult> {
    if (MOCK) {
      if (!emailInput || !password) throw new Error('Missing credentials');
      const fakeToken = 'mock.' + Math.random().toString(36).slice(2);
      try {
        sessionStorage.setItem('vayd_token', fakeToken);
        sessionStorage.setItem('vayd_email', emailInput);
      } catch {}
      setTokenState(fakeToken);
      setEmail(emailInput);
      return {
        token: fakeToken,
        user: { email: emailInput, requiresPasswordReset: false, resetPasswordCode: null },
        resetRequired: false,
      };
    }

    const { data } = await http.post('/auth/login', { email: emailInput, password });

    // Your response example:
    // { token: "...", user: { requiresPasswordReset: true, resetPasswordCode: "808759", ... } }
    const token: string | null = data?.token ?? null;
    const user = (data?.user ?? null) as LoginResult['user'];
    const resetRequired = !!(user?.requiresPasswordReset || user?.resetPasswordCode);
    const resetCode = user?.resetPasswordCode ?? null;

    // Persist token/email if token is present (even if reset is required)
    if (token) {
      try {
        sessionStorage.setItem('vayd_token', token);
        sessionStorage.setItem('vayd_email', emailInput);
      } catch {}
      setTokenState(token);
      setEmail(emailInput);
    } else {
      // No token returned — ensure we don't have a stale token set
      try {
        sessionStorage.removeItem('vayd_token');
      } catch {}
      setTokenState(null);
    }

    return { token, user, resetRequired, resetCode };
  }

  function logout() {
    try {
      sessionStorage.removeItem('vayd_token');
      sessionStorage.removeItem('vayd_email');
    } catch {}
    setTokenState(null);
    setEmail(null);
    setToken(null);
  }

  const value = useMemo<AuthContextType>(
    () => ({
      token: tokenState,
      userEmail: email,
      role,
      login,
      logout,
    }),
    [tokenState, email, role]
  );

  function decodeJwt(token: string): any | null {
    try {
      const base64Url = token.split('.')[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const jsonPayload = decodeURIComponent(
        atob(base64)
          .split('')
          .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
          .join('')
      );
      return JSON.parse(jsonPayload);
    } catch {
      return null;
    }
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { http, setToken } from '../api/http';

// If you added setLogoutHandler/forceLogout in http.ts (as suggested),
// import it; otherwise this will be tree-shaken/ignored by TS if not exported.
import { setLogoutHandler } from '../api/http';

const MOCK = import.meta.env.VITE_MOCK_AUTH === '1';

type AuthContextType = {
  token: string | null;
  userEmail: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // Initialize from sessionStorage once on mount
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

  // Keep axios Authorization token in sync with state
  useEffect(() => {
    setToken(tokenState); // this schedules auto-logout if you used the http.ts from earlier
  }, [tokenState]);

  // Register a global logout handler that the axios interceptor can call on 401
  useEffect(() => {
    if (typeof setLogoutHandler === 'function') {
      setLogoutHandler(() => {
        try {
          sessionStorage.removeItem('vayd_token');
          sessionStorage.removeItem('vayd_email');
        } catch {
          /* empty */
        }
        setTokenState(null);
        setEmail(null);
        setToken(null);
      });
    }
  }, []);

  async function login(emailInput: string, password: string) {
    if (MOCK) {
      if (!emailInput || !password) throw new Error('Missing credentials');
      // mock token (no exp claim; auto-logout won’t schedule—fine for mock)
      const fakeToken = 'mock.' + Math.random().toString(36).slice(2);
      try {
        sessionStorage.setItem('vayd_token', fakeToken);
        sessionStorage.setItem('vayd_email', emailInput);
      } catch {
        /* empty */
      }
      setTokenState(fakeToken);
      setEmail(emailInput);
      return;
    }

    const { data } = await http.post('/auth/login', { email: emailInput, password });
    if (!data?.token) throw new Error('Invalid login response');

    try {
      sessionStorage.setItem('vayd_token', data.token);
      sessionStorage.setItem('vayd_email', emailInput);
    } catch {
      /* empty */
    }
    setTokenState(data.token);
    setEmail(emailInput);
  }

  function logout() {
    try {
      sessionStorage.removeItem('vayd_token');
      sessionStorage.removeItem('vayd_email');
    } catch {
      /* empty */
    }
    setTokenState(null);
    setEmail(null);
    setToken(null);
  }

  const value = useMemo<AuthContextType>(
    () => ({
      token: tokenState,
      userEmail: email,
      login,
      logout,
    }),
    [tokenState, email]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

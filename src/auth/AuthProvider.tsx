// src/auth/useAuth.tsx
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { http, setToken } from '../api/http';
import { setLogoutHandler } from '../api/http';
import { trackLogin, trackLogout } from '../utils/analytics';

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
  userId: string | null;
  role: string[];
  clientInfo: any | null; // Store client information for clients
  // ⬅️ now returns a LoginResult instead of void
  login: (email: string, password: string) => Promise<LoginResult>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [tokenState, setTokenState] = useState<string | null>(() => {
    try {
      return localStorage.getItem('vayd_token');
    } catch {
      return null;
    }
  });
  const [email, setEmail] = useState<string | null>(() => {
    try {
      return localStorage.getItem('vayd_email');
    } catch {
      return null;
    }
  });
  const [role, setRole] = useState<string[]>([]);
  const [userId, setUserId] = useState<string | null>(() => {
    try {
      return localStorage.getItem('vayd_clientId');
    } catch {
      return null;
    }
  });
  const [clientInfo, setClientInfo] = useState<any | null>(() => {
    try {
      const stored = localStorage.getItem('vayd_clientInfo');
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    setToken(tokenState);
    if (tokenState) {
      const payload = decodeJwt(tokenState);
      const roleClaim = payload?.role || [];
      setRole(Array.isArray(roleClaim) ? roleClaim : [String(roleClaim)]);
      const claimedId =
        payload?.clientId ??
        payload?.client_id ??
        payload?.client?.id ??
        payload?.userId ??
        payload?.user_id ??
        payload?.sub ??
        null;
      if (claimedId != null) {
        const claimString = String(claimedId);
        if (claimString !== userId) {
          setUserId(claimString);
          try {
            localStorage.setItem('vayd_clientId', claimString);
          } catch {}
        }
      }
    } else {
      setRole([]);
      setUserId(null);
      try {
        localStorage.removeItem('vayd_clientId');
      } catch {}
    }
  }, [tokenState, userId]);

  useEffect(() => {
    setToken(tokenState);
  }, [tokenState]);

  // Listen for storage changes across tabs
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'vayd_token') {
        setTokenState(e.newValue);
      } else if (e.key === 'vayd_email') {
        setEmail(e.newValue);
      } else if (e.key === 'vayd_clientId') {
        setUserId(e.newValue);
      } else if (e.key === 'vayd_clientInfo') {
        try {
          setClientInfo(e.newValue ? JSON.parse(e.newValue) : null);
        } catch {}
      }
    };
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  useEffect(() => {
    if (typeof setLogoutHandler === 'function') {
      setLogoutHandler(() => {
        try {
          localStorage.removeItem('vayd_token');
          localStorage.removeItem('vayd_email');
          localStorage.removeItem('vayd_clientId');
          localStorage.removeItem('vayd_clientInfo');
        } catch {}
        setTokenState(null);
        setEmail(null);
        setUserId(null);
        setClientInfo(null);
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
        localStorage.setItem('vayd_token', fakeToken);
        localStorage.setItem('vayd_email', emailInput);
        localStorage.setItem('vayd_clientId', 'mock-client');
      } catch {}
      setTokenState(fakeToken);
      setEmail(emailInput);
      setUserId('mock-client');
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
        localStorage.setItem('vayd_token', token);
        localStorage.setItem('vayd_email', emailInput);
        const inferredClientId =
          (user as any)?.clientId ??
          (user as any)?.client?.id ??
          user?.id ??
          null;
        if (inferredClientId != null) {
          const inferredStr = String(inferredClientId);
          localStorage.setItem('vayd_clientId', inferredStr);
          setUserId(inferredStr);
        } else {
          localStorage.removeItem('vayd_clientId');
          setUserId(null);
        }
        
        // Fetch and store client info if user is a client
        const roles: string[] = Array.isArray((user as any)?.role)
          ? (user as any).role
          : (user as any)?.role
            ? [String((user as any).role)]
            : Array.isArray((user as any)?.roles)
              ? (user as any).roles
              : [];
        const isClient = roles.includes('client') || roles.includes('Client');
        
        if (isClient && inferredClientId != null) {
          // Import fetchClientInfo dynamically to avoid circular dependency
          import('../api/clientPortal').then(({ fetchClientInfo }) => {
            fetchClientInfo(inferredClientId)
              .then((info) => {
                if (info) {
                  try {
                    localStorage.setItem('vayd_clientInfo', JSON.stringify(info));
                    setClientInfo(info);
                  } catch {}
                }
              })
              .catch((err) => {
                console.warn('Failed to fetch client info after login:', err);
              });
          });
        }
      } catch {}
      setTokenState(token);
      setEmail(emailInput);
      
      // Track successful login
      trackLogin('email');
    } else {
      // No token returned — ensure we don't have a stale token set
      try {
        localStorage.removeItem('vayd_token');
        localStorage.removeItem('vayd_email');
        localStorage.removeItem('vayd_clientId');
        localStorage.removeItem('vayd_clientInfo');
      } catch {}
      setTokenState(null);
      setEmail(null);
      setUserId(null);
      setClientInfo(null);
    }

    return { token, user, resetRequired, resetCode };
  }

  function logout() {
    // Track logout before clearing state
    trackLogout();
    
    try {
      localStorage.removeItem('vayd_token');
      localStorage.removeItem('vayd_email');
      localStorage.removeItem('vayd_clientId');
      localStorage.removeItem('vayd_clientInfo');
    } catch {}
    setTokenState(null);
    setEmail(null);
    setToken(null);
    setUserId(null);
    setClientInfo(null);
  }

  const value = useMemo<AuthContextType>(
    () => ({
      token: tokenState,
      userEmail: email,
      userId,
      role,
      clientInfo,
      login,
      logout,
    }),
    [tokenState, email, userId, role, clientInfo]
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

// src/auth/AuthContext.tsx
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

type AuthState = {
  accessToken: string | null;
  refreshToken: string | null;
};

type AuthContextValue = {
  accessToken: string | null;
  login: (accessToken: string, refreshToken?: string) => void;
  logout: () => void;
  setTokens: (tokens: { accessToken: string; refreshToken?: string }) => void;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function decodeExp(token: string): number | null {
  try {
    const [, payloadB64] = token.split(".");
    const json = JSON.parse(atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/")));
    // JWT exp is seconds since epoch
    return typeof json?.exp === "number" ? json.exp : null;
  } catch {
    return null;
  }
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const navigate = useNavigate();
  const [auth, setAuth] = useState<AuthState>(() => {
    const a = localStorage.getItem("accessToken");
    const r = localStorage.getItem("refreshToken");
    return { accessToken: a, refreshToken: r };
  });

  const logoutTimer = useRef<number | null>(null);

  const clearTimer = () => {
    if (logoutTimer.current) {
      window.clearTimeout(logoutTimer.current);
      logoutTimer.current = null;
    }
  };

  const logout = () => {
    clearTimer();
    setAuth({ accessToken: null, refreshToken: null });
    localStorage.removeItem("accessToken");
    localStorage.removeItem("refreshToken");
    // broadcast to other tabs
    localStorage.setItem("logout_broadcast", String(Date.now()));
    navigate("/login", { replace: true });
  };

  // Schedule auto-logout a few seconds before exp (with skew protection)
  const scheduleLogoutForToken = (token: string | null) => {
    clearTimer();
    if (!token) return;

    const expSec = decodeExp(token);
    if (!expSec) return; // no exp claim, skip proactive timer (reactive 401s will catch it)

    const nowMs = Date.now();
    const expMs = expSec * 1000;
    const skewMs = 10_000; // 10s safety
    const fireIn = Math.max(0, expMs - nowMs - skewMs);

    // If already expired, log out immediately
    if (fireIn === 0) {
      logout();
      return;
    }

    logoutTimer.current = window.setTimeout(() => {
      // Optional: try silent refresh here; if that fails, logout()
      logout();
    }, fireIn) as unknown as number;
  };

  const setTokens: AuthContextValue["setTokens"] = ({ accessToken, refreshToken }) => {
    setAuth({ accessToken, refreshToken: refreshToken ?? auth.refreshToken });
    localStorage.setItem("accessToken", accessToken);
    if (refreshToken) localStorage.setItem("refreshToken", refreshToken);
    scheduleLogoutForToken(accessToken);
  };

  const login: AuthContextValue["login"] = (accessToken, refreshToken) => {
    setTokens({ accessToken, refreshToken });
    navigate("/", { replace: true });
  };

  // Init timer on first load / token changes
  useEffect(() => {
    scheduleLogoutForToken(auth.accessToken);
    return clearTimer;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.accessToken]);

  // Listen for cross-tab logout
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === "logout_broadcast") {
        logout();
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ accessToken: auth.accessToken, login, logout, setTokens }),
    [auth.accessToken]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};
